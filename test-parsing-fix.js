/**
 * Unit test for the DTS parsing fix
 * This extracts and tests just the parsing logic without VS Code dependencies
 */

// Copy of the functions from extension.ts (extracted for testing)
function normalizeHexValues(line) {
    return line.replace(/0x([0-9a-fA-F]+)/g, (match, hexPart) => {
        const normalized = hexPart.toLowerCase();
        const padded = normalized.length % 2 === 1 ? '0' + normalized : normalized;
        return `0x${padded}`;
    });
}

function normalizeArrays(line) {
    line = line.replace(/<\s*([^>]+)\s*>/g, (match, content) => {
        const elements = content.trim().split(/\s+/).filter((el) => el.length > 0);
        return `< ${elements.join(' ')} >`;
    });
    
    line = line.replace(/=\s*(["][^"]*"(?:\s*,\s*"[^"]*")*)\s*;/g, (match, content) => {
        const stringElements = [];
        let currentElement = '';
        let inQuotes = false;
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            if (char === '"') {
                inQuotes = !inQuotes;
                currentElement += char;
            } else if (char === ',' && !inQuotes) {
                stringElements.push(currentElement.trim());
                currentElement = '';
            } else {
                currentElement += char;
            }
        }
        if (currentElement.trim()) {
            stringElements.push(currentElement.trim());
        }
        
        if (stringElements.length > 1) {
            const formattedElements = stringElements.join(', ');
            return ` = ${formattedElements};`;
        }
        
        return ` = ${content.trim()};`;
    });
    
    return line;
}

function finalizeNode(nodeLines, options, depth = 0) {
    if (nodeLines.length < 2 || depth > 5) return nodeLines;
    
    const firstLine = nodeLines[0];
    const lastLine = nodeLines[nodeLines.length - 1];
    const contentLines = nodeLines.slice(1, -1);
    
    const firstLineIndent = (firstLine.match(/^(\s*)/) || ['', ''])[1];
    const propertyIndent = firstLineIndent + '    ';
    
    const childNodes = [];
    const propertyLines = [];
    let i = 0;
    
    while (i < contentLines.length) {
        const line = contentLines[i];
        const trimmed = line.trim();
        
        if (trimmed === '') {
            i++;
            continue;
        }
        
        if (trimmed.match(/^[a-zA-Z0-9_-]+(\s*:\s*.*)?(@[0-9a-fA-F]+)?\s*\{/) || trimmed.match(/^[a-zA-Z0-9_-]+\s*\{/)) {
            const nodeLines = [];
            let braceCount = 0;
            
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
            
            childNodes.push(nodeLines);
        } else {
            propertyLines.push(line);
            i++;
        }
    }
    
    // Merge multi-line properties
    const mergedProperties = [];
    let currentProperty = '';
    
    for (let i = 0; i < propertyLines.length; i++) {
        const line = propertyLines[i];
        const trimmed = line.trim();
        if (trimmed === '') continue;
        
        if (!trimmed.endsWith(';') && !trimmed.endsWith(',')) {
            currentProperty += (currentProperty ? ' ' : '') + trimmed;
            continue;
        }
        
        currentProperty += (currentProperty ? ' ' : '') + trimmed;
        
        if (trimmed.endsWith(',') && i + 1 < propertyLines.length) {
            const nextLine = propertyLines[i + 1].trim();
            if (nextLine.startsWith('"') || !nextLine.includes('=')) {
                continue;
            }
        }
        
        mergedProperties.push(currentProperty);
        currentProperty = '';
    }
    
    if (currentProperty.trim()) {
        mergedProperties.push(currentProperty);
    }
    
    // Process properties
    const properties = [];
    
    for (const propertyText of mergedProperties) {
        // Skip any lines that are just closing braces or other structural elements
        const cleanText = propertyText.trim();
        if (cleanText === '' || cleanText === '}' || cleanText === '};') {
            continue;
        }
        
        let normalizedLine = propertyText;
        let sortKey = propertyText;
        
        if (options.normalizeHexValues) {
            normalizedLine = normalizeHexValues(normalizedLine);
        }
        
        if (options.normalizeArrays) {
            normalizedLine = normalizeArrays(normalizedLine);
        }
        
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
    
    // Process child nodes
    const processedChildNodes = [];
    
    for (const childNodeLines of childNodes) {
        const processedLines = finalizeNode(childNodeLines, options, depth + 1);
        
        const nodeDeclaration = childNodeLines[0];
        let nodeNameMatch = nodeDeclaration.match(/^\s*([a-zA-Z0-9_-]+)\s*:/);
        if (!nodeNameMatch) {
            nodeNameMatch = nodeDeclaration.match(/^\s*([a-zA-Z0-9_-]+)\s*\{/);
        }
        const sortKey = nodeNameMatch ? nodeNameMatch[1].trim() : 'zzz_unknown';
        
        processedChildNodes.push({
            lines: processedLines,
            sortKey: sortKey
        });
    }
    
    // Sort child nodes if enabled
    if (options.sortProperties && processedChildNodes.length > 1) {
        processedChildNodes.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    }
    
    // Rebuild the node
    const result = [firstLine];
    
    properties.forEach(prop => {
        // Strip existing indentation and apply consistent property indentation
        const cleanLine = prop.normalized.trim();
        result.push(propertyIndent + cleanLine);
    });
    
    processedChildNodes.forEach(node => {
        node.lines.forEach(line => {
            result.push(line);
        });
    });
    
    result.push(lastLine);
    return result;
}

function semanticDtsNormalization(content, options) {
    if (!options.sortProperties) {
        return content;
    }
    
    const lines = content.split('\n');
    const result = [];
    
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        
        if (trimmed.match(/^[a-zA-Z0-9_-]+(\s*:\s*.*)?(@[0-9a-fA-F]+)?\s*\{/) || trimmed.match(/^[a-zA-Z0-9_-]+\s*\{/)) {
            const nodeLines = [];
            let braceCount = 0;
            
            do {
                nodeLines.push(lines[i]);
                const lineContent = lines[i];
                braceCount += (lineContent.match(/\{/g) || []).length - (lineContent.match(/\}/g) || []).length;
                i++;
            } while (braceCount > 0 && i < lines.length);
            
            const processedNode = finalizeNode(nodeLines, options);
            result.push(...processedNode);
        } else {
            result.push(line);
            i++;
        }
    }
    
    return result.join('\n');
}

// Test the problematic input with deeper nesting
const testInput = `reserved-memory {
    #address-cells = < 0x01 >;
    #size-cells = < 0x01 >;
    
    cpuapp_data: memory@2f000000 {
        #address-cells = < 0x01 >;
        #size-cells = < 0x01 >;
        
        memory@2f0b3000 {
            reg = < 0x2f0b3000 0x7000 >;
        };
        memory@2f0ba000 {
            reg = < 0x2f0ba000 0x1000 >;
        };
    };
    
    cpurad_data: memory@1f000000 {
        reg = < 0x1f000000 0x7000 >;
    };
}`;

const simpleTestInput = `reserved-memory {
    #address-cells = < 0x01 >;
    #size-cells = < 0x01 >;
    
    memory@2f0b3000 {
        reg = < 0x2f0b3000 0x7000 >;
    };
    memory@2f0ba000 {
        reg = < 0x2f0ba000 0x1000 >;
    };
    memory@2f0bb000 {
        reg = < 0x2f0bb000 0x1000 >;
    };
}`;

const options = {
    stripLineComments: true,
    stripBlockComments: true,
    preserveStringLiterals: true,
    normalizeWhitespace: true,
    semanticComparison: true,
    normalizeHexValues: true,
    normalizeArrays: true,
    sortProperties: true
};

console.log("=== Test 1: Simple Case ===");
console.log("Input:");
console.log(simpleTestInput);

console.log("\n=== Processed Output ===");
try {
    const result = semanticDtsNormalization(simpleTestInput, options);
    console.log(result);
    
    // Count closing braces for memory nodes specifically
    const memoryNodesWithClosingBraces = (result.match(/memory@[^}]*\}/g) || []).length;
    const totalMemoryNodes = (result.match(/memory@\w+/g) || []).length;
    
    console.log(`\nMemory nodes with closing braces: ${memoryNodesWithClosingBraces}`);
    console.log(`Total memory nodes found: ${totalMemoryNodes}`);
    
    if (memoryNodesWithClosingBraces === totalMemoryNodes) {
        console.log("✅ All memory nodes have closing braces!");
    } else {
        console.log("❌ Some memory nodes are missing closing braces!");
    }
} catch (error) {
    console.error("Error during processing:", error);
}

console.log("\n\n=== Test 2: Complex Nested Case ===");
console.log("Input:");
console.log(testInput);

console.log("\n=== Processed Output ===");
try {
    const result2 = semanticDtsNormalization(testInput, options);
    console.log(result2);
} catch (error) {
    console.error("Error during processing:", error);
}

