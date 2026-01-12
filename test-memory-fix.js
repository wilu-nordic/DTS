/**
 * Test to verify that memory@address nodes are properly recognized and parsed
 */

// Copy the functions from the compiled extension for testing
const fs = require('fs');

// Import our compiled functions (simplified versions for testing)

function normalizeHexValues(line) {
    return line.replace(/0x([0-9a-fA-F]+)/g, (match, hexPart) => {
        const normalized = hexPart.toLowerCase();
        const padded = normalized.length % 2 === 1 ? '0' + normalized : normalized;
        return `0x${padded}`;
    });
}

function finalizeNode(nodeLines, options, depth = 0, nodeDesc = 'unknown') {
    if (nodeLines.length < 2 || depth > 5) return nodeLines;
    
    const indent = '  '.repeat(depth);
    console.log(`${indent}DEBUG: finalizeNode processing "${nodeDesc}" (depth ${depth}, ${nodeLines.length} lines)`);
    
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
        
        // Using the new improved regex patterns
        if (trimmed.match(/^[a-zA-Z0-9_-]+(@[0-9a-fA-F]+)?\s*\{/) || trimmed.match(/^[a-zA-Z0-9_-]+\s*:\s*.+\{/)) {
            console.log(`${indent}  DEBUG: Found child node: "${trimmed}"`);
            const nodeLines = [];
            let braceCount = 0;
            const childStartIdx = i;
            
            do {
                if (i < contentLines.length) {
                    const nodeLine = contentLines[i];
                    nodeLines.push(nodeLine);
                    
                    const openBraces = (nodeLine.match(/\{/g) || []).length;
                    const closeBraces = (nodeLine.match(/\}/g) || []).length;
                    braceCount += openBraces - closeBraces;
                    i++;
                }
            } while (braceCount > 0 && i < contentLines.length);
            
            console.log(`${indent}  DEBUG: Child node extracted (${nodeLines.length} lines)`);
            childNodes.push(nodeLines);
        } else {
            propertyLines.push(line);
            i++;
        }
    }
    
    // Process properties
    const properties = [];
    for (const propertyText of propertyLines) {
        const cleanText = propertyText.trim();
        if (cleanText === '' || cleanText === '}' || cleanText === '};') {
            continue;
        }
        
        let normalizedLine = propertyText;
        let sortKey = propertyText;
        
        if (options.normalizeHexValues) {
            normalizedLine = normalizeHexValues(normalizedLine);
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
    
    if (options.sortProperties) {
        properties.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    }
    
    // Process child nodes
    const processedChildNodes = [];
    
    console.log(`${indent}DEBUG: Processing ${childNodes.length} child nodes`);
    for (let idx = 0; idx < childNodes.length; idx++) {
        const childNodeLines = childNodes[idx];
        const childDesc = childNodeLines[0].trim();
        console.log(`${indent}  DEBUG: Processing child ${idx + 1}/${childNodes.length}: "${childDesc}"`);
        
        const processedLines = finalizeNode(childNodeLines, options, depth + 1, childDesc);
        
        // Use the new improved node name extraction
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
    
    if (options.sortProperties && processedChildNodes.length > 1) {
        const beforeSort = processedChildNodes.map(n => n.sortKey);
        processedChildNodes.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        const afterSort = processedChildNodes.map(n => n.sortKey);
        console.log(`${indent}DEBUG: Child nodes sorted:`);
        console.log(`${indent}  Before: [${beforeSort.join(', ')}]`);
        console.log(`${indent}  After:  [${afterSort.join(', ')}]`);
    }
    
    // Rebuild the node
    const result = [firstLine];
    
    console.log(`${indent}DEBUG: Rebuilding node with ${properties.length} properties and ${processedChildNodes.length} child nodes`);
    
    properties.forEach(prop => {
        const cleanLine = prop.normalized.trim();
        result.push(propertyIndent + cleanLine);
    });
    
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

function semanticDtsNormalization(content, options) {
    if (!options.sortProperties) {
        return content;
    }
    
    console.log('\n=== DEBUG: semanticDtsNormalization started ===');
    const lines = content.split('\n');
    const result = [];
    
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Using the new improved regex patterns
        if (trimmed.match(/^[a-zA-Z0-9_-]+(@[0-9a-fA-F]+)?\s*\{/) || trimmed.match(/^[a-zA-Z0-9_-]+\s*:\s*.+\{/)) {
            console.log(`DEBUG: Found node at line ${i}: "${trimmed}"`);
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
            console.log(`DEBUG: Node spans lines ${startLine} to ${endLine} (${nodeLines.length} lines total)`);
            console.log(`DEBUG: Node content preview: ${nodeLines[0].trim()} ... ${nodeLines[nodeLines.length-1].trim()}`);
            
            const processedNode = finalizeNode(nodeLines, options, 0, trimmed);
            result.push(...processedNode);
            console.log(`DEBUG: Node processed, added ${processedNode.length} lines to result`);
        } else {
            result.push(line);
            i++;
        }
    }
    
    return result.join('\n');
}

// Test input with problematic memory@2f0b2000 pattern
const testInput = `reserved-memory {
    #address-cells = <1>;
    #size-cells = <1>;
    
    cpuapp_data: memory@2f000000 {
        #address-cells = <1>;
        #size-cells = <1>;
        
        memory@2f0b2000 {
            reg = <0x2f0b2000 0x1000>;
        };
        memory@2f0b3000 {
            reg = <0x2f0b3000 0x7000>;
        };
        memory@2f0ba000 {
            reg = <0x2f0ba000 0x1000>;
        };
    };
    
    cpurad_data: memory@1f000000 {
        reg = <0x1f000000 0x7000>;
    };
}`;

const testInput2 = `reserved-memory {
    #address-cells = <1>;
    #size-cells = <1>;
    
    memory@2f0b2000 {
        reg = <0x2f0b2000 0x1000>;
    };
    
    cpuapp_data: memory@2f000000 {
        #address-cells = <1>;
        #size-cells = <1>;
        
        memory@2f0b3000 {
            reg = <0x2f0b3000 0x7000>;
        };
        memory@2f0ba000 {
            reg = <0x2f0ba000 0x1000>;
        };
    };
    
    cpurad_data: memory@1f000000 {
        reg = <0x1f000000 0x7000>;
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

console.log("=== Testing memory@2f0b2000 node recognition ===");
console.log("\nOriginal input 1 (memory@2f0b2000 nested):");
console.log(testInput);

console.log("\n=== Processed Output 1 ===");
const result1 = semanticDtsNormalization(testInput, options);
console.log(result1);

console.log("\n=== Analysis 1 ===");
const memory2f0b2000Count1 = (result1.match(/memory@2f0b2000/g) || []).length;
console.log(`memory@2f0b2000 appears ${memory2f0b2000Count1} times`);

if (memory2f0b2000Count1 === 1) {
    console.log("✅ memory@2f0b2000 appears exactly once - FIXED!");
} else {
    console.log("❌ memory@2f0b2000 appears multiple times or not at all");
}

console.log("\n" + "=".repeat(50));
console.log("\nOriginal input 2 (memory@2f0b2000 at top level):");
console.log(testInput2);

console.log("\n=== Processed Output 2 ===");
const result2 = semanticDtsNormalization(testInput2, options);
console.log(result2);

console.log("\n=== Analysis 2 ===");
const memory2f0b2000Count2 = (result2.match(/memory@2f0b2000/g) || []).length;
console.log(`memory@2f0b2000 appears ${memory2f0b2000Count2} times`);

if (memory2f0b2000Count2 === 1) {
    console.log("✅ memory@2f0b2000 appears exactly once - FIXED!");
} else {
    console.log("❌ memory@2f0b2000 appears multiple times or not at all");
}

// Test if nodes are properly sorted now
const sortedNodes = result2.match(/\s+(memory@[a-fA-F0-9]+)\s+\{/g) || [];
console.log("\nSorted memory nodes found:", sortedNodes.map(n => n.trim()));

console.log("\n=== Testing node name extraction ===");
const nodeNames = [];
const lines = testInput2.split('\n');
for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^[a-zA-Z0-9_-]+(@[0-9a-fA-F]+)?\s*\{/) || trimmed.match(/^[a-zA-Z0-9_-]+\s*:\s*.+\{/)) {
        let nodeNameMatch = line.match(/^\s*([a-zA-Z0-9_-]+)\s*:/);
        if (!nodeNameMatch) {
            nodeNameMatch = line.match(/^\s*([a-zA-Z0-9_@]+)(?=\s*\{)/);
        }
        const nodeName = nodeNameMatch ? nodeNameMatch[1].trim() : 'unknown';
        nodeNames.push({line: trimmed, name: nodeName});
    }
}

console.log("Extracted node names:");
nodeNames.forEach(node => {
    console.log(`  "${node.line}" -> "${node.name}"`);
});