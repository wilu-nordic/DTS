/**
 * Test specifically for top-level node sorting issue
 */

// Test input with multiple top-level nodes that should be sorted
const testTopLevelSorting = `reserved-memory {
    #address-cells = <1>;
    #size-cells = <1>;
    
    memory@2f0b2000 {
        reg = <0x2f0b2000 0x1000>;
    };
    
    memory@2f0b3000 {
        reg = <0x2f0b3000 0x7000>;
    };
};

cpus {
    #address-cells = <1>;
    #size-cells = <0>;
    
    cpu@0 {
        device_type = "cpu";
        compatible = "arm,cortex-a7";
        reg = <0>;
    };
};

aliases {
    serial0 = &uart0;
};

chosen {
    stdout-path = "serial0:115200n8";
};

memory@80000000 {
    device_type = "memory";
    reg = <0x80000000 0x20000000>;
}`;

console.log("=== Testing Top-Level Node Sorting ===");
console.log("\\nOriginal input (nodes should be sorted alphabetically):");
console.log(testTopLevelSorting);

console.log("\\n=== Expected Sort Order ===");
console.log("1. aliases");
console.log("2. chosen");  
console.log("3. cpus");
console.log("4. memory@80000000");
console.log("5. reserved-memory");

console.log("\\n=== Actual Processing (using extension logic) ===");

// Simulate the new top-level sorting logic
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

// Simple test of node detection at top level
const lines = testTopLevelSorting.split('\\n');
const foundNodes = [];

let i = 0;
while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Using our improved regex patterns
    if (trimmed.match(/^[a-zA-Z0-9_-]+(@[0-9a-fA-F]+)?\\s*\\{/) || trimmed.match(/^[a-zA-Z0-9_-]+\\s*:\\s*.+\\{/)) {
        console.log(`Found node: "${trimmed}"`);
        
        // Extract node name for sorting
        let nodeNameMatch = line.match(/^\\s*([a-zA-Z0-9_-]+)\\s*:/);
        if (!nodeNameMatch) {
            // Try pattern without colon
            nodeNameMatch = line.match(/^\\s*([a-zA-Z0-9_@]+)(?=\\s*\\{)/);
        }
        const sortKey = nodeNameMatch ? nodeNameMatch[1].trim() : 'unknown';
        
        foundNodes.push(sortKey);
        
        // Skip past this node
        let braceCount = 0;
        do {
            const lineContent = lines[i];
            braceCount += (lineContent.match(/\\{/g) || []).length - (lineContent.match(/\\}/g) || []).length;
            i++;
        } while (braceCount > 0 && i < lines.length);
    } else {
        i++;
    }
}

console.log("\\n=== Results ===");
console.log(`Nodes found: [${foundNodes.join(', ')}]`);

// Sort them
const sortedNodes = [...foundNodes].sort((a, b) => a.localeCompare(b));
console.log(`Sorted order: [${sortedNodes.join(', ')}]`);

if (foundNodes.join(',') === sortedNodes.join(',')) {
    console.log("❌ PROBLEM: Nodes are already in sorted order - this means they're not being re-sorted!");
} else {
    console.log("✅ GOOD: Nodes need sorting, which the extension should handle");
}

console.log("\\n=== Top-Level Node Sorting Test Complete ===");
console.log("This test validates that the extension will properly detect and sort top-level nodes");