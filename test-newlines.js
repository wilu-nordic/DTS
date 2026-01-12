const extension = require('./src/extension.ts');

const testInput = `cpus {
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

// Just test the basic structure - can't directly call TypeScript functions from JS
console.log('Input lines:', testInput.split('\n').length);
console.log('Input:');
console.log(testInput);
console.log('\n---\nLooking for extra blank lines in output formatting...');
