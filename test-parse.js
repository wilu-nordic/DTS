// Quick test to verify the parsing fix
const fs = require('fs');

// Read the compiled extension code
const extensionCode = fs.readFileSync('./out/extension.js', 'utf8');

// Extract the stripCommentsFromContent function (simplified version for testing)
const testContent = `
reserved-memory {
    #address-cells = <1>;
    #size-cells = <1>;
    
    cpurad_data: memory@1f000000 {
        reg = <0x1f000000 0x7000>;
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
};`;

console.log("Testing DTS parsing fix...");
console.log("Input content:");
console.log(testContent);
console.log("\nIf the fix worked, we should see properly formatted output without duplicated closing braces or repeated properties.");