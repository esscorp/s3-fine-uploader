'use strict';

var pkg = require('./package.json');

module.exports = function(grunt) {

	// Initialize config.
	grunt.initConfig({
		pkg: pkg
	});

	grunt.loadTasks('grunts');
	grunt.registerTask('lint', ['eslint']);
	grunt.registerTask('default', ['lint']);
};
