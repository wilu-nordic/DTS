import * as vscode from 'vscode';
import * as path from 'path';

// Interface for comment filtering options
interface FilterOptions {
	stripLineComments: boolean;
	stripBlockComments: boolean;
	preserveStringLiterals: boolean;
	normalizeWhitespace: boolean;
	semanticComparison: boolean;
	normalizeHexValues: boolean;
	normalizeArrays: boolean;
	sortProperties: boolean;
}

// Interface for saved comparison configurations
interface ComparisonConfig {
	id: string;
	name: string;
	file1Path: string;
	file2Path: string;
	filterOptions: FilterOptions;
	autoRefresh: boolean;
	created: number;
}

// Global state for active comparisons and watchers
let savedConfigurations: ComparisonConfig[] = [];
let activeWatchers: Map<string, vscode.FileSystemWatcher[]> = new Map();
let context: vscode.ExtensionContext;
let statusBarItem: vscode.StatusBarItem;

export function activate(extensionContext: vscode.ExtensionContext) {
	console.log('DTS Diff Tool extension is now active!');
	context = extensionContext;

	// Create status bar item for showing comparison info
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.command = 'dtsDiff.loadComparison';
	context.subscriptions.push(statusBarItem);

	// Load saved configurations
	loadConfigurations();
	updateStatusBar();

	// Default filter options
	const defaultOptions: FilterOptions = {
		stripLineComments: true,
		stripBlockComments: true,
		preserveStringLiterals: true,
		normalizeWhitespace: true,
		semanticComparison: true,
		normalizeHexValues: true,
		normalizeArrays: true,
		sortProperties: true
	};

	// Load saved advanced options asynchronously
	loadAdvancedOptions(defaultOptions).then(() => {
		console.log('Advanced options loaded');
	});

	// Register command to compare two DTS files with comment filtering
	const compareFiles = vscode.commands.registerCommand('dtsDiff.compareFiles', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('Please open a .dts or .dtsi file first');
			return;
		}

		// Validate file extension
		const ext = path.extname(activeEditor.document.fileName);
		if (ext !== '.dts' && ext !== '.dtsi') {
			vscode.window.showErrorMessage('This command only works with .dts and .dtsi files');
			return;
		}

		// Show file picker for second file
		const fileUri = await vscode.window.showOpenDialog({
			canSelectMany: false,
			openLabel: 'Select file to compare with',
			filters: {
				'Device Tree Files': ['dts', 'dtsi'],
				'All Files': ['*']
			},
			defaultUri: vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri
		});

		if (!fileUri || fileUri.length === 0) {
			return;
		}

		await compareDtsFiles(activeEditor.document.uri, fileUri[0], context, defaultOptions);
	});

	// Register command to save current comparison configuration
	const saveComparison = vscode.commands.registerCommand('dtsDiff.saveComparison', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('Please open a .dts or .dtsi file first');
			return;
		}

		// Show file picker for second file
		const fileUri = await vscode.window.showOpenDialog({
			canSelectMany: false,
			openLabel: 'Select file to compare with',
			filters: {
				'Device Tree Files': ['dts', 'dtsi'],
				'All Files': ['*']
			},
			defaultUri: vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri
		});

		if (!fileUri || fileUri.length === 0) {
			return;
		}

		// Ask for configuration name
		const configName = await vscode.window.showInputBox({
			prompt: 'Enter a name for this comparison configuration',
			placeHolder: 'e.g., "Main vs Build Output"'
		});

		if (!configName) {
			return;
		}

		await saveComparisonConfig(activeEditor.document.uri, fileUri[0], configName, false, defaultOptions);
	});

	// Register command to load and run saved comparison
	const loadComparison = vscode.commands.registerCommand('dtsDiff.loadComparison', async () => {
		if (savedConfigurations.length === 0) {
			vscode.window.showInformationMessage('No saved comparison configurations found');
			return;
		}

		const configItems = savedConfigurations.map(config => ({
			label: config.name,
			description: `${getShortPath(config.file1Path)} ↔ ${getShortPath(config.file2Path)}`,
			detail: `${config.autoRefresh ? '🔄 Auto-refresh' : '⏸️ Manual'} | Click for full paths`,
			config: config
		}));

		const selected = await vscode.window.showQuickPick(configItems, {
			placeHolder: 'Select a saved comparison configuration',
			onDidSelectItem: (item: any) => {
				// Show full paths in status bar when hovering
				if (item && item.config) {
					vscode.window.setStatusBarMessage(
						`📁 ${item.config.file1Path} ↔ ${item.config.file2Path}`, 
						3000
					);
				}
			}
		});

		if (selected) {
			await runSavedComparison(selected.config);
		}
	});

	// Register command to delete a specific comparison directly
	const deleteComparisonDirect = vscode.commands.registerCommand('dtsDiff.deleteComparison', async () => {
		await deleteComparison();
	});

	// Register command to manage saved comparisons
	const manageComparisons = vscode.commands.registerCommand('dtsDiff.manageComparisons', async () => {
		const actions = [
			'View saved comparisons',
			'Delete a comparison',
			'Toggle auto-refresh for a comparison',
			'Refresh all active comparisons'
		];

		const action = await vscode.window.showQuickPick(actions, {
			placeHolder: 'What would you like to do?'
		});

		switch (action) {
			case 'View saved comparisons':
				await showSavedComparisons();
				break;
			case 'Delete a comparison':
				await deleteComparison();
				break;
			case 'Toggle auto-refresh for a comparison':
				await toggleAutoRefresh();
				break;
			case 'Refresh all active comparisons':
				await refreshAllComparisons();
				break;
		}
	});

	// Register command to show current comparison details
	const showComparisonDetails = vscode.commands.registerCommand('dtsDiff.showComparisonDetails', async () => {
		const activeConfigs = savedConfigurations.filter(config => config.autoRefresh);
		
		if (activeConfigs.length === 0) {
			vscode.window.showInformationMessage('No active comparisons with auto-refresh enabled');
			return;
		}

		const items = activeConfigs.map(config => ({
			label: config.name,
			description: 'Show full file paths',
			detail: `${getShortPath(config.file1Path)} ↔ ${getShortPath(config.file2Path)}`,
			config: config
		}));

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select comparison to view details'
		});

		if (selected) {
			const config = selected.config;
			vscode.window.showInformationMessage(
				`Comparison: ${config.name}\n\nLeft file: ${config.file1Path}\n\nRight file: ${config.file2Path}\n\nAuto-refresh: ${config.autoRefresh ? 'Enabled' : 'Disabled'}`,
				{ modal: true }
			);
		}
	});

	// Register command to configure advanced comparison options
	const configureAdvancedOptions = vscode.commands.registerCommand('dtsDiff.configureAdvancedOptions', async () => {
		// Get the current saved options to ensure dialog shows correct state
		const currentSavedOptions = context.globalState.get<Partial<FilterOptions>>('advancedOptions', {});
		const currentOptions = { ...defaultOptions, ...currentSavedOptions };
		
		const newOptions = await showAdvancedOptionsDialog(currentOptions);
		if (newOptions) {
			// Update the global default options
			Object.assign(defaultOptions, newOptions);
			vscode.window.showInformationMessage('Advanced comparison options updated and saved');
		}
	});

	// Register command to compare with clipboard
	const compareWithClipboard = vscode.commands.registerCommand('dtsDiff.compareWithClipboard', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('Please open a .dts or .dtsi file first');
			return;
		}

		const clipboardContent = await vscode.env.clipboard.readText();
		if (!clipboardContent.trim()) {
			vscode.window.showErrorMessage('Clipboard is empty');
			return;
		}

		await compareWithClipboardContent(activeEditor, clipboardContent, context, defaultOptions);
	});

	// Register command to strip comments from current file
	const stripComments = vscode.commands.registerCommand('dtsDiff.stripComments', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage('Please open a .dts or .dtsi file first');
			return;
		}

		const document = activeEditor.document;
		const originalContent = document.getText();
		const strippedContent = stripCommentsFromContent(originalContent, defaultOptions);
		
		// Show in a new document
		const newDoc = await vscode.workspace.openTextDocument({
			content: strippedContent,
			language: 'c' // Use C language for syntax highlighting
		});
		
		await vscode.window.showTextDocument(newDoc, vscode.ViewColumn.Beside);
		vscode.window.showInformationMessage('Comments stripped from DTS file');
	});

	context.subscriptions.push(
		compareFiles,
		compareWithClipboard,
		stripComments,
		saveComparison,
		loadComparison,
		deleteComparisonDirect,
		manageComparisons,
		showComparisonDetails,
		configureAdvancedOptions
	);
}

async function compareDtsFiles(file1Uri: vscode.Uri, file2Uri: vscode.Uri, context: vscode.ExtensionContext, options: FilterOptions) {
	try {
		// Read both files
		const file1Content = await vscode.workspace.fs.readFile(file1Uri);
		const file2Content = await vscode.workspace.fs.readFile(file2Uri);

		// Convert to string and strip comments
		const file1Text = stripCommentsFromContent(file1Content.toString(), options);
		const file2Text = stripCommentsFromContent(file2Content.toString(), options);

		// Debug: Check if files are actually different
		console.log(`File 1 path: ${file1Uri.path}`);
		console.log(`File 2 path: ${file2Uri.path}`);
		console.log(`File 1 length after filtering: ${file1Text.length}`);
		console.log(`File 2 length after filtering: ${file2Text.length}`);
		console.log(`Files are identical after filtering: ${file1Text === file2Text}`);

		if (file1Text === file2Text) {
			vscode.window.showInformationMessage('The files are identical after comment filtering');
			return;
		}

		// Create temporary files for comparison
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}
		
		const tempDir = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'dts-diff-temp');
		
		// Ensure temp directory exists
		try {
			await vscode.workspace.fs.createDirectory(tempDir);
		} catch (error) {
			// Directory might already exist
		}

		const timestamp = Date.now();
		const randomId = Math.random().toString(36).substring(7);
		// Use full path info to ensure unique names, especially for same filenames in different directories
		const file1Name = path.basename(file1Uri.path, path.extname(file1Uri.path));
		const file2Name = path.basename(file2Uri.path, path.extname(file2Uri.path));
		const file1Dir = path.basename(path.dirname(file1Uri.path));
		const file2Dir = path.basename(path.dirname(file2Uri.path));
		
		const tempFile1 = vscode.Uri.joinPath(tempDir, `${file1Dir}-${file1Name}-filtered-${timestamp}-${randomId}-1.dts`);
		const tempFile2 = vscode.Uri.joinPath(tempDir, `${file2Dir}-${file2Name}-filtered-${timestamp}-${randomId}-2.dts`);

		// Write filtered content to temp files
		await vscode.workspace.fs.writeFile(tempFile1, Buffer.from(file1Text, 'utf8'));
		await vscode.workspace.fs.writeFile(tempFile2, Buffer.from(file2Text, 'utf8'));

		// Debug: Verify temp files were written correctly
		const verifyFile1 = await vscode.workspace.fs.readFile(tempFile1);
		const verifyFile2 = await vscode.workspace.fs.readFile(tempFile2);
		const verifyContent1 = verifyFile1.toString();
		const verifyContent2 = verifyFile2.toString();
		console.log(`Temp file 1 path: ${tempFile1.toString()}`);
		console.log(`Temp file 2 path: ${tempFile2.toString()}`);
		console.log(`Temp file 1 length: ${verifyContent1.length}`);
		console.log(`Temp file 2 length: ${verifyContent2.length}`);
		console.log(`First 100 chars of temp file 1: ${verifyContent1.substring(0, 100)}`);
		console.log(`First 100 chars of temp file 2: ${verifyContent2.substring(0, 100)}`);
		console.log(`Temp files are identical: ${verifyContent1 === verifyContent2}`);

		// Open diff view
		const file1DisplayName = file1Name === file2Name ? `${file1Dir}/${file1Name}` : file1Name;
		const file2DisplayName = file1Name === file2Name ? `${file2Dir}/${file2Name}` : file2Name;
		
		// Show full paths in title if files have same name or if paths are short enough
		const file1FullPath = file1Uri.path;
		const file2FullPath = file2Uri.path;
		const useFullPaths = file1Name === file2Name || (file1FullPath.length + file2FullPath.length < 100);
		
		const title = useFullPaths 
			? `${file1FullPath} ↔ ${file2FullPath} (Comments Filtered)`
			: `${file1DisplayName} ↔ ${file2DisplayName} (Comments Filtered)`;
		
		console.log(`Opening diff with title: ${title}`);
		console.log(`Left file: ${tempFile1.toString()}`);
		console.log(`Right file: ${tempFile2.toString()}`);
		
		await vscode.commands.executeCommand('vscode.diff', tempFile1, tempFile2, title);

		// Show notification with full file paths
		const shortPath1 = file1FullPath.split('/').slice(-3).join('/');
		const shortPath2 = file2FullPath.split('/').slice(-3).join('/');
		vscode.window.showInformationMessage(
			`DTS comparison: ${shortPath1} ↔ ${shortPath2}`,
			'Show Details'
		).then(selection => {
			if (selection === 'Show Details') {
				vscode.window.showInformationMessage(
					`Full paths:\nLeft: ${file1FullPath}\nRight: ${file2FullPath}`,
					{ modal: true }
				);
			}
		});
		
		// Clean up temp files after a delay
		setTimeout(async () => {
			try {
				await vscode.workspace.fs.delete(tempFile1);
				await vscode.workspace.fs.delete(tempFile2);
			} catch (error) {
				// Ignore cleanup errors
			}
		}, 30000); // Clean up after 30 seconds
		
	} catch (error) {
		vscode.window.showErrorMessage(`Error comparing files: ${error}`);
	}
}

async function compareWithClipboardContent(activeEditor: vscode.TextEditor, clipboardContent: string, context: vscode.ExtensionContext, options: FilterOptions) {
	try {
		// Create temporary files for comparison
		const tempDir = vscode.Uri.joinPath(context.globalStorageUri, 'temp');
		
		// Ensure temp directory exists
		try {
			await vscode.workspace.fs.createDirectory(tempDir);
		} catch (error) {
			// Directory might already exist
		}

		const originalContent = activeEditor.document.getText();
		const strippedOriginal = stripCommentsFromContent(originalContent, options);
		const strippedClipboard = stripCommentsFromContent(clipboardContent, options);
		
		const timestamp = Date.now();
		const tempOriginalPath = vscode.Uri.joinPath(tempDir, `original-${timestamp}.dts`);
		const tempClipboardPath = vscode.Uri.joinPath(tempDir, `clipboard-${timestamp}.dts`);

		await vscode.workspace.fs.writeFile(tempOriginalPath, Buffer.from(strippedOriginal));
		await vscode.workspace.fs.writeFile(tempClipboardPath, Buffer.from(strippedClipboard));

		// Open diff view
		const title = `${path.basename(activeEditor.document.fileName)} ↔ Clipboard (Comments Filtered)`;
		await vscode.commands.executeCommand('vscode.diff', tempOriginalPath, tempClipboardPath, title);

		vscode.window.showInformationMessage('File compared with clipboard content (comments filtered)');
		
		// Clean up temp files after a delay
		setTimeout(async () => {
			try {
				await vscode.workspace.fs.delete(tempOriginalPath);
				await vscode.workspace.fs.delete(tempClipboardPath);
			} catch (error) {
				// Ignore cleanup errors
			}
		}, 30000);
		
	} catch (error) {
		vscode.window.showErrorMessage(`Error comparing with clipboard: ${error}`);
	}
}

function stripCommentsFromContent(content: string, options: FilterOptions): string {
	console.log('stripCommentsFromContent called with semanticComparison:', options.semanticComparison, 'sortProperties:', options.sortProperties);
	
	// First, do basic comment removal
	let result = basicCommentRemoval(content, options);
	
	// If semantic comparison is enabled, parse and normalize the DTS structure
	if (options.semanticComparison) {
		console.log('Calling semanticDtsNormalization');
		result = semanticDtsNormalization(result, options);
	} else {
		console.log('Semantic comparison disabled, skipping normalization');
	}
	
	return result;
}

function basicCommentRemoval(content: string, options: FilterOptions): string {
	let result = '';
	let i = 0;
	let inBlockComment = false;
	let inLineComment = false;
	let inString = false;
	let stringDelimiter = '';
	let lineStart = true;
	
	while (i < content.length) {
		const char = content[i];
		const nextChar = i + 1 < content.length ? content[i + 1] : '';
		
		// Handle string literals to avoid treating comment markers inside strings as comments
		if (!inBlockComment && !inLineComment && options.preserveStringLiterals) {
			if ((char === '"' || char === "'") && (i === 0 || content[i - 1] !== '\\')) {
				if (!inString) {
					inString = true;
					stringDelimiter = char;
				} else if (char === stringDelimiter) {
					inString = false;
					stringDelimiter = '';
				}
				result += char;
				i++;
				lineStart = false;
				continue;
			}
		}
		
		if (!inString) {
			// Check for start of block comment
			if (!inLineComment && options.stripBlockComments && char === '/' && nextChar === '*') {
				inBlockComment = true;
				i += 2; // Skip both '/' and '*'
				continue;
			}
			
			// Check for end of block comment
			if (inBlockComment && char === '*' && nextChar === '/') {
				inBlockComment = false;
				i += 2; // Skip both '*' and '/'
				// Preserve newlines after block comments
				while (i < content.length && (content[i] === ' ' || content[i] === '\t')) {
					i++;
				}
				continue;
			}
			
			// Check for line comment
			if (!inBlockComment && options.stripLineComments && char === '/' && nextChar === '/') {
				inLineComment = true;
				i += 2; // Skip both '/' characters
				continue;
			}
			
			// Check for end of line comment
			if (inLineComment && (char === '\n' || char === '\r')) {
				inLineComment = false;
				result += char;
				i++;
				lineStart = true;
				continue;
			}
		}
		
		// Add character if not in a comment
		if (!inBlockComment && !inLineComment) {
			// Handle whitespace normalization
			if (options.normalizeWhitespace) {
				if (char === '\n' || char === '\r') {
					// Preserve newlines but normalize them
					if (char === '\r' && nextChar === '\n') {
						result += '\n';
						i += 2;
					} else {
						result += '\n';
						i++;
					}
					lineStart = true;
					continue;
				} else if (char === ' ' || char === '\t') {
					// Normalize whitespace: convert tabs to spaces and collapse multiple spaces
					if (!lineStart) {
						let spaceCount = 0;
						while (i < content.length && (content[i] === ' ' || content[i] === '\t')) {
							spaceCount += content[i] === '\t' ? 4 : 1;
							i++;
						}
						if (spaceCount > 0 && i < content.length) {
							result += ' ';
						}
						continue;
					} else {
						// Skip leading whitespace but preserve indentation structure
						let indentLevel = 0;
						while (i < content.length && (content[i] === ' ' || content[i] === '\t')) {
							indentLevel += content[i] === '\t' ? 4 : 1;
							i++;
						}
						if (indentLevel > 0 && i < content.length) {
							result += '    '.repeat(Math.floor(indentLevel / 4)) + ' '.repeat(indentLevel % 4);
						}
						lineStart = false;
						continue;
					}
				}
			}
			
			result += char;
			lineStart = false;
		}
		
		i++;
	}
	
	// Clean up the result
	return result
		.split('\n')
		.map(line => line.trimEnd()) // Remove trailing whitespace
		.filter((line, index, arr) => {
			// Remove empty lines but keep one empty line between sections
			if (line.length === 0) {
				return index === 0 || index === arr.length - 1 || 
					   arr[index - 1].length > 0 || arr[index + 1].length > 0;
			}
			return true;
		})
		.join('\n')
		.replace(/\n{3,}/g, '\n\n'); // Replace multiple empty lines with just two
}

function semanticDtsNormalization(content: string, options: FilterOptions): string {
	console.log('semanticDtsNormalization called, sortProperties:', options.sortProperties);
	
	// If sorting is not enabled, just return content
	if (!options.sortProperties) {
		console.log('Sorting disabled, returning content as-is');
		return content;
	}
	
	console.log('\n=== DEBUG: semanticDtsNormalization started ===');
	// Collect and sort top-level nodes before processing
	const lines = content.split('\n');
	const result: string[] = [];
	
	// Collect all top-level nodes and non-node lines
	const topLevelNodes: Array<{lines: string[], sortKey: string, startLine: number}> = [];
	const nonNodeLines: Array<{line: string, lineNumber: number}> = [];
	
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();
		
		// If this is a node declaration, extract the complete node
		// Match patterns like: "memory@2f0b2000 {", "cpuapp_data: memory@2f000000 {", "cpus {", "reserved-memory {"
		if (trimmed.match(/^[a-zA-Z0-9_-]+(@[0-9a-fA-F]+)?\s*\{/) || trimmed.match(/^[a-zA-Z0-9_-]+\s*:\s*.+\{/)) {
			console.log(`DEBUG: Found top-level node at line ${i}: "${trimmed}"`);
			// Extract the complete node
			const nodeLines = [];
			let braceCount = 0;
			const startLine = i;
			
			do {
				nodeLines.push(lines[i]);
				const lineContent = lines[i];
				braceCount += (lineContent.match(/\{/g) || []).length - (lineContent.match(/\}/g) || []).length;
				i++;
			} while (braceCount > 0 && i < lines.length);
			
			const endLine = i - 1;
			console.log(`DEBUG: Top-level node spans lines ${startLine} to ${endLine} (${nodeLines.length} lines total)`);
			
			// Extract node name for sorting
			const nodeDeclaration = nodeLines[0];
			let nodeNameMatch = nodeDeclaration.match(/^\s*([a-zA-Z0-9_-]+)\s*:/);
			if (!nodeNameMatch) {
				// Try pattern without colon (e.g., "cpus {" or "memory@2f0b2000 {")
				nodeNameMatch = nodeDeclaration.match(/^\s*([a-zA-Z0-9_@]+)(?=\s*\{)/);
			}
			const sortKey = nodeNameMatch ? nodeNameMatch[1].trim() : 'zzz_unknown';
			
			console.log(`DEBUG: Top-level node sort key: "${sortKey}"`);
			topLevelNodes.push({
				lines: nodeLines,
				sortKey: sortKey,
				startLine: startLine
			});
		} else {
			// Regular line (property or comment), store with line number
			nonNodeLines.push({line: line, lineNumber: i});
			i++;
		}
	}
	
	// Sort top-level nodes if enabled
	if (options.sortProperties && topLevelNodes.length > 1) {
		const beforeSort = topLevelNodes.map(n => n.sortKey);
		topLevelNodes.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
		const afterSort = topLevelNodes.map(n => n.sortKey);
		console.log(`DEBUG: Top-level nodes sorted:`);
		console.log(`  Before: [${beforeSort.join(', ')}]`);
		console.log(`  After:  [${afterSort.join(', ')}]`);
	}
	
	// Add non-node lines that come before any nodes
	const firstNodeLine = topLevelNodes.length > 0 ? Math.min(...topLevelNodes.map(n => n.startLine)) : lines.length;
	nonNodeLines
		.filter(item => item.lineNumber < firstNodeLine)
		.forEach(item => result.push(item.line));
	
	// Process and add sorted top-level nodes
	topLevelNodes.forEach((node, idx) => {
		console.log(`DEBUG: Processing top-level node ${idx + 1}/${topLevelNodes.length}: "${node.sortKey}"`);
		const processedNode = finalizeNode(node.lines, options, 0, node.sortKey);
		result.push(...processedNode);
		console.log(`DEBUG: Top-level node processed, added ${processedNode.length} lines to result`);
		
		// Add any non-node lines that were between this node and the next
		if (idx < topLevelNodes.length - 1) {
			const nextNodeLine = topLevelNodes[idx + 1].startLine;
			const currentNodeEndLine = node.startLine + node.lines.length - 1;
			nonNodeLines
				.filter(item => item.lineNumber > currentNodeEndLine && item.lineNumber < nextNodeLine)
				.forEach(item => result.push(item.line));
		}
	});
	
	// Add any remaining non-node lines after all nodes
	if (topLevelNodes.length > 0) {
		const lastNodeEndLine = topLevelNodes[topLevelNodes.length - 1].startLine + 
			topLevelNodes[topLevelNodes.length - 1].lines.length - 1;
		nonNodeLines
			.filter(item => item.lineNumber > lastNodeEndLine)
			.forEach(item => result.push(item.line));
	}
	
	return result.join('\n');
}



function finalizeNode(nodeLines: string[], options: FilterOptions, depth: number = 0, nodeDesc: string = 'unknown'): string[] {
	if (nodeLines.length < 2 || depth > 5) return nodeLines; // Prevent infinite recursion
	
	const indent = '  '.repeat(depth);
	console.log(`${indent}DEBUG: finalizeNode processing "${nodeDesc}" (depth ${depth}, ${nodeLines.length} lines)`);
	
	const firstLine = nodeLines[0]; // Node declaration (e.g., "gpio6: gpio@938c00 {")
	const lastLine = nodeLines[nodeLines.length - 1]; // Closing brace
	const contentLines = nodeLines.slice(1, -1); // Content between braces
	
	// Determine the base indentation from the first line
	const firstLineIndent = firstLine.match(/^(\s*)/)?.[1] || '';
	const propertyIndent = firstLineIndent + '    '; // Add 4 spaces for properties
	
	// Separate child nodes from properties using better detection
	const childNodes: string[][] = [];
	const propertyLines: string[] = [];
	let i = 0;
	
	while (i < contentLines.length) {
		const line = contentLines[i];
		const trimmed = line.trim();
		
		// Skip empty lines
		if (trimmed === '') {
			i++;
			continue;
		}
		
		// Better DTS child node detection: look for both "name: something {" and "name@address {" patterns
		// Match patterns like: "memory@2f0b2000 {", "cpuapp_data: memory@2f000000 {", "cpus {", "reserved-memory {"
		if (trimmed.match(/^[a-zA-Z0-9_-]+(@[0-9a-fA-F]+)?\s*\{/) || trimmed.match(/^[a-zA-Z0-9_-]+\s*:\s*.+\{/)) {
			console.log(`${indent}  DEBUG: Found child node: "${trimmed}"`);
			// This is a child node, extract the complete node
			const nodeLines: string[] = [];
			let braceCount = 0;
			const childStartIdx = i;
			
			// Extract complete child node
			do {
				if (i < contentLines.length) {
					const nodeLine = contentLines[i];
					nodeLines.push(nodeLine);
					
					const openBraces = (nodeLine.match(/{/g) || []).length;
					const closeBraces = (nodeLine.match(/}/g) || []).length;
					braceCount += openBraces - closeBraces;
					i++;
				}
			} while (braceCount > 0 && i < contentLines.length);
			
			console.log(`${indent}  DEBUG: Child node extracted (${nodeLines.length} lines)`);
			childNodes.push(nodeLines);
		}
		// It's a property line
		else {
			propertyLines.push(line);
			i++;
		}
	}
	
	// Merge multi-line properties first
	const mergedProperties: string[] = [];
	let currentProperty = '';
	
	for (let i = 0; i < propertyLines.length; i++) {
		const line = propertyLines[i];
		const trimmed = line.trim();
		if (trimmed === '') continue;
		
		// If line doesn't end with semicolon, it might be a multi-line property
		if (!trimmed.endsWith(';') && !trimmed.endsWith(',')) {
			currentProperty += (currentProperty ? ' ' : '') + trimmed;
			continue;
		}
		
		// Line ends with ; or , - complete the property
		currentProperty += (currentProperty ? ' ' : '') + trimmed;
		
		// If it ends with comma, check if next line continues the property
		if (trimmed.endsWith(',') && i + 1 < propertyLines.length) {
			const nextLine = propertyLines[i + 1].trim();
			// If next line starts with a quote or looks like a continuation, keep building
			if (nextLine.startsWith('"') || !nextLine.includes('=')) {
				continue;
			}
		}
		
		// Property is complete
		mergedProperties.push(currentProperty);
		currentProperty = '';
	}
	
	// Add any remaining property
	if (currentProperty.trim()) {
		mergedProperties.push(currentProperty);
	}
	
	// Extract and normalize properties
	const properties: Array<{original: string, normalized: string, sortKey: string}> = [];
	
	for (const propertyText of mergedProperties) {
		// Skip any lines that are just closing braces or other structural elements
		const cleanText = propertyText.trim();
		if (cleanText === '' || cleanText === '}' || cleanText === '};') {
			continue;
		}
		
		let normalizedLine = propertyText;
		let sortKey = propertyText;
		
		// Normalize hex values if enabled
		if (options.normalizeHexValues) {
			normalizedLine = normalizeHexValues(normalizedLine);
		}
		
		// Normalize arrays if enabled
		if (options.normalizeArrays) {
			normalizedLine = normalizeArrays(normalizedLine);
		}
		
		// Extract property name for sorting
		const propertyMatch = propertyText.match(/^([^=;:]+)[:=]?/);
		if (propertyMatch) {
			sortKey = propertyMatch[1].trim();
		}
		
		properties.push({
			original: propertyText,
			normalized: normalizedLine,
			sortKey: sortKey
		});
	}
	
	// Sort properties if enabled
	if (options.sortProperties) {
		properties.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
	}
	
	// Process child nodes if enabled 
	const processedChildNodes: Array<{lines: string[], sortKey: string}> = [];
	
	console.log(`${indent}DEBUG: Processing ${childNodes.length} child nodes`);
	for (let idx = 0; idx < childNodes.length; idx++) {
		const childNodeLines = childNodes[idx];
		const childDesc = childNodeLines[0].trim();
		console.log(`${indent}  DEBUG: Processing child ${idx + 1}/${childNodes.length}: "${childDesc}"`);
		
		// Recursively process each child node with increased depth
		const processedLines = finalizeNode(childNodeLines, options, depth + 1, childDesc);
		
		// Extract node name for sorting (e.g., "cpuapp_data" from "cpuapp_data: memory@2f000000 {" or "memory@2f0b2000" from "memory@2f0b2000 {")
		const nodeDeclaration = childNodeLines[0];
		let nodeNameMatch = nodeDeclaration.match(/^\s*([a-zA-Z0-9_-]+)\s*:/);
		if (!nodeNameMatch) {
			// Try pattern without colon (e.g., "cpus {" or "memory@2f0b2000 {")
			nodeNameMatch = nodeDeclaration.match(/^\s*([a-zA-Z0-9_@]+)(?=\s*\{)/);
		}
		const sortKey = nodeNameMatch ? nodeNameMatch[1].trim() : 'zzz_unknown';
		
		console.log(`${indent}  DEBUG: Child node sort key: "${sortKey}"`);
		processedChildNodes.push({
			lines: processedLines,
			sortKey: sortKey
		});
	}
	
	// Sort child nodes if enabled (this should sort cpuapp_data, cpurad_data, etc.)
	if (options.sortProperties && processedChildNodes.length > 1) {
		const beforeSort = processedChildNodes.map(n => n.sortKey);
		processedChildNodes.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
		const afterSort = processedChildNodes.map(n => n.sortKey);
		console.log(`${indent}DEBUG: Child nodes sorted:`);
		console.log(`${indent}  Before: [${beforeSort.join(', ')}]`);
		console.log(`${indent}  After:  [${afterSort.join(', ')}]`);
	}
	
	// Rebuild the node with proper indentation
	const result = [firstLine];
	
	console.log(`${indent}DEBUG: Rebuilding node with ${properties.length} properties and ${processedChildNodes.length} child nodes`);
	
	// Add properties first
	properties.forEach(prop => {
		// Strip existing indentation and apply consistent property indentation
		const cleanLine = prop.normalized.trim();
		result.push(propertyIndent + cleanLine);
	});
	
	// Add child nodes after properties
	processedChildNodes.forEach((node, idx) => {
		console.log(`${indent}  DEBUG: Adding child node ${idx + 1}: "${node.sortKey}" (${node.lines.length} lines)`);
		node.lines.forEach(line => {
			result.push(line);
		});
	});
	
	result.push(lastLine);
	console.log(`${indent}DEBUG: Node rebuild complete (${result.length} total lines)`);
	return result;
}

function normalizeHexValues(line: string): string {
	// Normalize hex values to consistent format (lowercase, consistent padding)
	return line.replace(/0x([0-9a-fA-F]+)/g, (match, hexPart) => {
		// Convert to lowercase and ensure consistent format
		const normalized = hexPart.toLowerCase();
		// Pad to even number of digits for consistency
		const padded = normalized.length % 2 === 1 ? '0' + normalized : normalized;
		return `0x${padded}`;
	});
}

function normalizeArrays(line: string): string {
	// Handle both < > style arrays and comma-separated string arrays
	
	// First handle < > style arrays (like reg = < 0x938c00 0x200 >)
	line = line.replace(/<\s*([^>]+)\s*>/g, (match, content) => {
		// Split by whitespace and filter out empty elements
		const elements = content.trim().split(/\s+/).filter((el: string) => el.length > 0);
		// Join with consistent spacing
		return `< ${elements.join(' ')} >`;
	});
	
	// Handle string array properties (like compatible = "str1", "str2", "str3")
	// But preserve commas within individual quoted strings (like "nordic,nrf-gpio")
	line = line.replace(/=\s*(["][^"]*"(?:\s*,\s*"[^"]*")*)\s*;/g, (match, content) => {
		// Split by comma, but only on commas that are outside quotes
		const stringElements: string[] = [];
		let currentElement = '';
		let inQuotes = false;
		
		for (let i = 0; i < content.length; i++) {
			const char = content[i];
			if (char === '"') {
				inQuotes = !inQuotes;
				currentElement += char;
			} else if (char === ',' && !inQuotes) {
				// This comma is between array elements, not within a string
				stringElements.push(currentElement.trim());
				currentElement = '';
			} else {
				currentElement += char;
			}
		}
		if (currentElement.trim()) {
			stringElements.push(currentElement.trim());
		}
		
		// If it's a multi-element array, format with space after comma between elements only
		if (stringElements.length > 1) {
			const formattedElements = stringElements.join(', ');
			return ` = ${formattedElements};`;
		}
		
		// Single element, just clean up spacing
		return ` = ${content.trim()};`;
	});
	
	return line;
}

async function showAdvancedOptionsDialog(currentOptions: FilterOptions): Promise<FilterOptions | undefined> {
	const enableItems = [];
	const disableItems = [];

	// Separate options into "enable" and "disable" actions based on current state
	const optionConfigs = [
		{
			name: 'Semantic Comparison',
			key: 'semanticComparison' as keyof FilterOptions,
			description: 'Parse and compare DTS structure semantically',
			detail: 'Ignores property order, focuses on content differences'
		},
		{
			name: 'Sort Properties',
			key: 'sortProperties' as keyof FilterOptions,
			description: 'Sort properties within nodes for consistent comparison',
			detail: 'Makes property order irrelevant in comparisons'
		},
		{
			name: 'Normalize Hex Values',
			key: 'normalizeHexValues' as keyof FilterOptions,
			description: 'Normalize hex values to consistent format',
			detail: 'e.g., 0x938C00 → 0x938c00 (lowercase, consistent padding)'
		},
		{
			name: 'Normalize Arrays',
			key: 'normalizeArrays' as keyof FilterOptions,
			description: 'Normalize array formatting',
			detail: 'e.g., <0x1 0x2> → < 0x1 0x2 > (consistent spacing)'
		},
		{
			name: 'Strip Line Comments',
			key: 'stripLineComments' as keyof FilterOptions,
			description: 'Remove // comments from comparison',
			detail: 'Ignores single-line comments when comparing'
		},
		{
			name: 'Strip Block Comments',
			key: 'stripBlockComments' as keyof FilterOptions,
			description: 'Remove /* */ comments from comparison',
			detail: 'Ignores block comments when comparing'
		},
		{
			name: 'Normalize Whitespace',
			key: 'normalizeWhitespace' as keyof FilterOptions,
			description: 'Normalize indentation and spacing',
			detail: 'Makes formatting differences irrelevant'
		}
	];

	// Build items showing current state - selection will represent final desired state
	const items = optionConfigs.map(config => {
		const isCurrentlyEnabled = currentOptions[config.key] as boolean;
		
		return {
			label: `${config.name}`,
			description: `${config.description}`,
			detail: `Currently: ${isCurrentlyEnabled ? 'Enabled' : 'Disabled'} | ${config.detail}`,
			key: config.key,
			currentState: isCurrentlyEnabled
		};
	});

	// Create a custom QuickPick to support pre-selection
	const quickPick = vscode.window.createQuickPick();
	quickPick.title = 'Advanced Comparison Options';
	quickPick.placeholder = 'Select which features you want enabled (checked = enabled, unchecked = disabled)';
	quickPick.canSelectMany = true;
	quickPick.ignoreFocusOut = true;
	quickPick.matchOnDescription = true;
	quickPick.matchOnDetail = true;
	quickPick.items = items;
	
	// Pre-select items that are currently enabled
	quickPick.selectedItems = items.filter(item => item.currentState);

	return new Promise<FilterOptions | undefined>((resolve) => {
		quickPick.onDidAccept(() => {
			const selectedItems = quickPick.selectedItems as Array<{
				label: string;
				description: string;
				detail: string;
				key: keyof FilterOptions;
				currentState: boolean;
			}>;
			quickPick.hide();

			// Build new options based on what's selected (not toggled)
			const newOptions = { ...currentOptions };
			
			// Set all options based on selection state
			optionConfigs.forEach(config => {
				const isSelected = selectedItems.some(item => item.key === config.key);
				(newOptions[config.key] as boolean) = isSelected;
			});

			// Save the new configuration
			saveAdvancedOptions(newOptions).then(() => {
				// Show summary of changes
				const changes: string[] = [];
				optionConfigs.forEach(config => {
					const oldValue = currentOptions[config.key] as boolean;
					const newValue = newOptions[config.key] as boolean;
					if (oldValue !== newValue) {
						changes.push(`${config.key}: ${newValue ? 'Enabled' : 'Disabled'}`);
					}
				});
				
				if (changes.length > 0) {
					vscode.window.showInformationMessage(`Updated options:\n${changes.join('\n')}`);
				}
				
				resolve(newOptions);
			});
		});

		quickPick.onDidHide(() => {
			quickPick.dispose();
			resolve(undefined);
		});

		quickPick.show();
	});
}

async function loadAdvancedOptions(defaultOptions: FilterOptions): Promise<void> {
	const saved = context.globalState.get<Partial<FilterOptions>>('advancedOptions', {});
	
	// Merge saved options with defaults
	Object.assign(defaultOptions, saved);
	
	console.log('Loaded advanced options:', defaultOptions);
}

async function saveAdvancedOptions(options: FilterOptions): Promise<void> {
	await context.globalState.update('advancedOptions', options);
	console.log('Saved advanced options:', options);
}

export function deactivate() {
	// Clean up watchers
	for (const watchers of activeWatchers.values()) {
		watchers.forEach(watcher => watcher.dispose());
	}
	activeWatchers.clear();
	
	// Clean up status bar
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}

// Helper functions
function getShortPath(fullPath: string): string {
	const uri = vscode.Uri.parse(fullPath);
	const pathParts = uri.path.split('/');
	if (pathParts.length <= 3) {
		return pathParts.join('/');
	}
	return '.../' + pathParts.slice(-2).join('/');
}

function updateStatusBar() {
	const activeConfigs = savedConfigurations.filter(config => config.autoRefresh);
	
	if (activeConfigs.length === 0) {
		statusBarItem.hide();
		return;
	}

	if (activeConfigs.length === 1) {
		const config = activeConfigs[0];
		statusBarItem.text = `🔄 DTS: ${config.name}`;
		statusBarItem.tooltip = `Active comparison: ${config.file1Path} ↔ ${config.file2Path}\nClick to manage comparisons`;
	} else {
		statusBarItem.text = `🔄 DTS: ${activeConfigs.length} active`;
		statusBarItem.tooltip = `${activeConfigs.length} active comparisons\nClick to manage`;
	}
	
	statusBarItem.show();
}

// Configuration management functions
function loadConfigurations() {
	const saved = context.globalState.get<ComparisonConfig[]>('savedComparisons', []);
	savedConfigurations = saved;
	
	// Restart watchers for configurations with auto-refresh enabled
	savedConfigurations
		.filter(config => config.autoRefresh)
		.forEach(config => setupFileWatchers(config));
}

async function saveConfigurations() {
	await context.globalState.update('savedComparisons', savedConfigurations);
}

async function saveComparisonConfig(file1Uri: vscode.Uri, file2Uri: vscode.Uri, name: string, autoRefresh: boolean, options: FilterOptions) {
	const config: ComparisonConfig = {
		id: Date.now().toString() + Math.random().toString(36).substring(7),
		name: name,
		file1Path: file1Uri.toString(),
		file2Path: file2Uri.toString(),
		filterOptions: options,
		autoRefresh: autoRefresh,
		created: Date.now()
	};

	savedConfigurations.push(config);
	await saveConfigurations();

	if (autoRefresh) {
		setupFileWatchers(config);
	}

	updateStatusBar();
	vscode.window.showInformationMessage(`Comparison configuration "${name}" saved!`);
	
	// Immediately run the comparison
	await runSavedComparison(config);
}

async function runSavedComparison(config: ComparisonConfig) {
	try {
		const file1Uri = vscode.Uri.parse(config.file1Path);
		const file2Uri = vscode.Uri.parse(config.file2Path);

		// Check if files still exist
		try {
			await vscode.workspace.fs.stat(file1Uri);
			await vscode.workspace.fs.stat(file2Uri);
		} catch (error) {
			vscode.window.showErrorMessage(`One or both files in comparison "${config.name}" no longer exist`);
			return;
		}

		await compareDtsFiles(file1Uri, file2Uri, context, config.filterOptions);
	} catch (error) {
		vscode.window.showErrorMessage(`Error running comparison "${config.name}": ${error}`);
	}
}

function setupFileWatchers(config: ComparisonConfig) {
	// Clean up existing watchers for this config
	const existingWatchers = activeWatchers.get(config.id);
	if (existingWatchers) {
		existingWatchers.forEach(watcher => watcher.dispose());
	}

	const watchers: vscode.FileSystemWatcher[] = [];

	// Create watchers for both files
	[config.file1Path, config.file2Path].forEach(filePath => {
		const uri = vscode.Uri.parse(filePath);
		const pattern = new vscode.RelativePattern(vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders![0], uri.fsPath);
		
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);
		
		const refreshComparison = async () => {
			console.log(`Auto-refreshing comparison: ${config.name}`);
			// Small delay to ensure file write is complete
			setTimeout(() => runSavedComparison(config), 500);
		};

		watcher.onDidChange(refreshComparison);
		watcher.onDidCreate(refreshComparison);
		
		watchers.push(watcher);
	});

	activeWatchers.set(config.id, watchers);
}

async function showSavedComparisons() {
	if (savedConfigurations.length === 0) {
		vscode.window.showInformationMessage('No saved comparison configurations');
		return;
	}

	const items = savedConfigurations.map(config => {
		return {
			label: config.name,
			description: `${getShortPath(config.file1Path)} ↔ ${getShortPath(config.file2Path)}`,
			detail: `${config.autoRefresh ? '🔄 Auto-refresh: ON' : '⏸️ Auto-refresh: OFF'} | Full paths in tooltip`,
			config: config
		};
	});

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Saved comparison configurations',
		onDidSelectItem: (item: any) => {
			if (item && item.config) {
				vscode.window.setStatusBarMessage(
					`📁 ${item.config.file1Path} ↔ ${item.config.file2Path}`, 
					5000
				);
			}
		}
	});

	if (selected) {
		await runSavedComparison(selected.config);
	}
}

async function deleteComparison() {
	if (savedConfigurations.length === 0) {
		vscode.window.showInformationMessage('No saved comparison configurations to delete');
		return;
	}

	const items = savedConfigurations.map(config => ({
		label: config.name,
		description: `${getShortPath(config.file1Path)} ↔ ${getShortPath(config.file2Path)}`,
		detail: `${config.autoRefresh ? '🔄 Auto-refresh' : '⏸️ Manual'} | Created: ${new Date(config.created).toLocaleDateString()}`,
		config: config
	}));

	// Add option to delete all configurations
	if (savedConfigurations.length > 1) {
		items.unshift({
			label: '$(trash) Delete ALL Configurations',
			description: `Delete all ${savedConfigurations.length} saved configurations`,
			detail: 'This action cannot be undone',
			config: null as any
		});
	}

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: `Select comparison to delete (${savedConfigurations.length} total)`,
		matchOnDescription: true,
		matchOnDetail: true
	});

	if (selected) {
		if (selected.config === null) {
			// Delete all configurations
			const confirmation = await vscode.window.showWarningMessage(
				`Are you sure you want to delete ALL ${savedConfigurations.length} saved comparison configurations? This action cannot be undone.`,
				{ modal: true },
				'Delete All',
				'Cancel'
			);

			if (confirmation === 'Delete All') {
				// Clean up all watchers
				activeWatchers.forEach(watchers => {
					watchers.forEach(watcher => watcher.dispose());
				});
				activeWatchers.clear();

				// Clear all configurations
				savedConfigurations = [];
				await saveConfigurations();
				updateStatusBar();

				vscode.window.showInformationMessage('All comparison configurations have been deleted');
			}
		} else {
			// Delete single configuration
			const confirmation = await vscode.window.showWarningMessage(
				`Are you sure you want to delete the comparison configuration "${selected.config.name}"?`,
				{ modal: true },
				'Delete',
				'Cancel'
			);

			if (confirmation === 'Delete') {
				// Clean up watchers
				const watchers = activeWatchers.get(selected.config.id);
				if (watchers) {
					watchers.forEach(watcher => watcher.dispose());
					activeWatchers.delete(selected.config.id);
				}

				// Remove from saved configurations
				savedConfigurations = savedConfigurations.filter(c => c.id !== selected.config.id);
				await saveConfigurations();
				updateStatusBar();

				vscode.window.showInformationMessage(`Deleted comparison configuration "${selected.config.name}"`);
			}
		}
	}
}

async function toggleAutoRefresh() {
	if (savedConfigurations.length === 0) {
		vscode.window.showInformationMessage('No saved comparison configurations');
		return;
	}

	const items = savedConfigurations.map(config => ({
		label: config.name,
		description: `${getShortPath(config.file1Path)} ↔ ${getShortPath(config.file2Path)}`,
		detail: config.autoRefresh ? '🔄 Currently: Auto-refresh ON' : '⏸️ Currently: Auto-refresh OFF',
		config: config
	}));

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select comparison to toggle auto-refresh'
	});

	if (selected) {
		selected.config.autoRefresh = !selected.config.autoRefresh;

		if (selected.config.autoRefresh) {
			setupFileWatchers(selected.config);
		} else {
			// Clean up watchers
			const watchers = activeWatchers.get(selected.config.id);
			if (watchers) {
				watchers.forEach(watcher => watcher.dispose());
				activeWatchers.delete(selected.config.id);
			}
		}

		await saveConfigurations();
		updateStatusBar();

		const status = selected.config.autoRefresh ? 'enabled' : 'disabled';
		vscode.window.showInformationMessage(`Auto-refresh ${status} for "${selected.config.name}"`);
	}
}

async function refreshAllComparisons() {
	const activeConfigs = savedConfigurations.filter(config => config.autoRefresh);
	
	if (activeConfigs.length === 0) {
		vscode.window.showInformationMessage('No configurations with auto-refresh enabled');
		return;
	}

	vscode.window.showInformationMessage(`Refreshing ${activeConfigs.length} comparison(s)...`);

	for (const config of activeConfigs) {
		await runSavedComparison(config);
		// Small delay between comparisons to avoid overwhelming VS Code
		await new Promise(resolve => setTimeout(resolve, 100));
	}
}