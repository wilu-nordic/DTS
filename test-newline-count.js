const fs = require('fs');
const path = require('path');

// Read the compiled JavaScript version
const extensionCode = fs.readFileSync(path.join(__dirname, 'out', 'extension.js'), 'utf8');

// Extract and run just the semantic normalization part
const testDts = `cpus {
	#address-cells = <1>;
	#size-cells = <0>;
	
	cpu@0 {
		device_type = "cpu";
		compatible = "arm,cortex-a7";
		reg = <0>;
	};
};

memory@80000000 {
	device_type = "memory";
	reg = <0x80000000 0x20000000>;
};`;

console.log('Input DTS:');
console.log(testDts);
console.log('\n=== INPUT STATS ===');
console.log('Lines:', testDts.split('\n').length);
console.log('Has trailing newlines:', testDts.endsWith('\n\n') ? 'YES' : 'NO');

// Count blank lines
const inputLines = testDts.split('\n');
const inputBlankLines = inputLines.filter(l => l.trim() === '').length;
console.log('Blank lines in input:', inputBlankLines);
