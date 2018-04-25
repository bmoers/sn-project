var gulp = require('gulp');
var jsdoc3 = require('gulp-jsdoc3');
var mocha = require('gulp-mocha');

var eslint = require('gulp-eslint'),
    reporter = require('eslint-detailed-reporter'),
    path = require('path'),
    fs = require('fs'),
    mkdirp = require('mkdirp');

var config = require('./config/project.json');

var jsDocConfig = require('./config/jsdoc.json');
jsDocConfig.opts.destination = path.resolve(config.application.dir.doc, 'docs');
jsDocConfig.templates.systemName = config.application.name;

var lintConfig = {
    destination:
        path.resolve(config.application.dir.doc, 'lint')
};

gulp.task('init', function () {
    mkdirp.mkdirp(jsDocConfig.opts.destination);
    mkdirp.mkdirp(lintConfig.destination);
});

gulp.task('eslint', ['init'], function () {

    var esLintReport = path.resolve(lintConfig.destination, 'index.html');
    console.log("EsLint to destination:", esLintReport);

    // ESLint ignores files with "node_modules" paths.
    // So, it's best to have gulp ignore the directory as well.
    // Also, Be sure to return the stream from the task;
    // Otherwise, the task may end before the stream has finished.
    return gulp.src(config.lint.concat('!node_modules/**'))
        // eslint() attaches the lint output to the "eslint" property
        // of the file object so it can be used by other modules.
        .pipe(eslint({
            fix: true,
            extends: "eslint:recommended",
            rules: {
                'valid-jsdoc': 1,
                'no-alert': 0,
                'no-bitwise': 0,
                'camelcase': 1,
                'curly': 1,
                'eqeqeq': 0,
                'no-eq-null': 0,
                'guard-for-in': 1,
                'no-empty': 1,
                'no-use-before-define': 0,
                'no-obj-calls': 2,
                'no-unused-vars': 0,
                'new-cap': 1,
                'no-shadow': 0,
                'strict': 0,
                'no-invalid-regexp': 2,
                'comma-dangle': 2,
                'no-undef': 1,
                'no-new': 1,
                'no-extra-semi': 1,
                'no-debugger': 2,
                'no-caller': 1,
                'semi': 1,
                'quotes': 0,
                'no-unreachable': 2
            },
            globals: [
                'jQuery',
                '$',
                'gs', 'sn_ws', 'Class', 'GlideDateTime', 'GlideRecord', 'GlideProperties',
                'GlideAggregate', 'GlideFilter', 'GlideTableHierarchy', 'TableUtils', 'JSON', 'Packages', 'g_form', 'current', 'previous',
                'g_navigation', 'g_document', 'GlideDialogWindow', 'GlideAjax', 'gel', 'request', 'response', 'parent', 'angular', '$j', 'action', 'g_list',
                'GlideModal', 'GwtMessage', 'g_i18n'
            ],
            envs: [
                'node',
                'browser',
                'angular'
            ]
        }))
        // eslint.format() outputs the lint results to the console.
        // Alternatively use eslint.formatEach() (see Docs).
        .pipe(eslint.format(reporter, function (results) {
            fs.writeFileSync(esLintReport, results);
        }))
    // To have the process exit with an error code (1) on
    // lint error, return the stream and pipe to failAfterError last.
    //.pipe(eslint.failAfterError());
});

gulp.task('jsdoc3', ['eslint'], function (done) {
    console.log("JsDoc to destination:", jsDocConfig.opts.destination);
    gulp.src(['README.md', './sn/**/*.js', './sn/**/*.jsdoc'], { read: false })
        .pipe(jsdoc3(jsDocConfig, function () {
            console.log("\tdone");
            done();
        }));
});

gulp.task('test', ['jsdoc3'], function () {
    return gulp.src(['test/*.js'], { read: false })
        .pipe(mocha({
            reporter: 'mochawesome', // 'xunit' 'spec'
            reporterOptions: {
                reportDir: path.resolve(config.application.dir.doc, 'test'),
                reportFilename: 'index.html',
                quiet: true,
                json: true
            },
            timeout: 30000,
            delay: true
        }));
});

/*
    mocha report as XML
*/
gulp.task('test-xunit', ['jsdoc3'], function () {
    return gulp.src(['test/*.js'], { read: false })
        .pipe(mocha({
            reporter: 'xunit', // 'xunit' 'spec'
            reporterOptions: {
                output: path.resolve(config.application.dir.doc, 'mocha-report.xml')
            },
            timeout: 30000,
            delay: true
        }));
});

gulp.task('build', ['test'], function () { });

gulp.task('default', ['build'], function () {

});


/*

// call JsDoc directly
gulp.task('docs', function (done) {
    var child_exec = require('child_process').exec;
    child_exec('node ./node_modules/jsdoc/jsdoc.js ./sn -c ./config/jsdoc.json -P ./package.json -d "' + config.opts.destination + '"', undefined, done); // node_modules\\.bin\\jsdoc -c jsdocconf.json -r
});

// this would be an alterlative to jsDoc3...

var gulpDocumentation = require('gulp-documentation');
gulp.task('doc', function () {
    return gulp.src(['./sn/*.js'], { read: false })
    .pipe(gulpDocumentation('html', {})).pipe(gulp.dest('html-documentation'));
});
*/

