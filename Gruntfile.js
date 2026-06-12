module.exports = function (grunt) {
    var path = require('path');
    // Project configuration.
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        clean: ['build', 'components'],
        karma: {
            unit: {
                configFile: 'karma.conf.js'
            }
        },
        copy: {
            dependencies: {
                files: [
                    {
                        expand: true,
                        cwd: 'node_modules/bootstrap/dist/',
                        src: ['css/bootstrap.min.css', 'js/bootstrap.min.js', 'fonts/glyphicons-halflings-regular.woff'],
                        dest: 'components/bootstrap/dist/'
                    },
                    {
                        expand: true,
                        cwd: 'node_modules/jquery/dist/',
                        src: 'jquery.min.js',
                        dest: 'components/jquery/'
                    },
                    {
                        expand: true,
                        cwd: 'node_modules/angular/',
                        src: 'angular.min.js',
                        dest: 'components/angular/'
                    }
                ]
            }
        },
        zip: {
            release: {
                router: function (filepath) {
                    var filename = path.basename(filepath);
                    if (filename == 'panel_production.html') {
                        return 'app/html/panel.html';
                    }
                    return filepath;
                },
                src: [
                    'components/bootstrap/dist/css/bootstrap.min.css',
                    'components/bootstrap/dist/js/bootstrap.min.js',
                    'components/bootstrap/dist/fonts/glyphicons-halflings-regular.woff',
                    'app/**',
                    '!app/html/panel.html',
                    'components/jquery/jquery.min.js',
                    'components/angular/angular.min.js',
                    'manifest.json'
                ],
                dest: 'build/storage-area-explorer-MV3-angular-v<%=pkg.version%>_' + Date.now() + '.zip'
            },
            testsCoverage: {
                compression: 'DEFLATE',
                src: [
                    'coverage/Chrome */**'
                ],
                dest: 'build/coverage.zip'
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-clean');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-zip');
    grunt.loadNpmTasks('grunt-karma');

    // Default task(s).
    grunt.registerTask('default', ['clean', 'karma', 'copy', 'zip']);

    // CI task with tests (legacy compatibility)
    grunt.registerTask("ci", ['clean', 'karma', 'copy', 'zip']);
    
    // New build task without tests
    grunt.registerTask("build", ['clean', 'copy', 'zip']);
};