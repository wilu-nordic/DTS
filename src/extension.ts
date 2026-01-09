import * as vscode from 'vscode';
import * as path from 'path';

// Interface for comment filtering options
interface FilterOptions {
	stripLineComments: boolean;
	stripBlockComments: boolean;
	preserveStringLiterals: boolean;
	normalizeWhitespace: boolean;
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
		normalizeWhitespace: true
	};

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

		// Ask if auto-refresh should be enabled
		const autoRefreshChoice = await vscode.window.showQuickPick(
			['Yes - Auto refresh on file changes', 'No - Manual refresh only'],
			{ placeHolder: 'Enable auto-refresh when files change?' }
		);

		const autoRefresh = autoRefreshChoice?.startsWith('Yes') ?? false;

		await saveComparisonConfig(activeEditor.document.uri, fileUri[0], configName, autoRefresh, defaultOptions);
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
		manageComparisons,
		showComparisonDetails
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
		detail: `Full paths: ${config.file1Path} | ${config.file2Path}`,
		config: config
	}));

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select comparison to delete'
	});

	if (selected) {
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