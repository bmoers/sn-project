var gulp = require('gulp'),
    jsdoc3 = require('gulp-jsdoc3'),
    mocha = require('gulp-mocha'),
    eslint = require('gulp-eslint'),
    reporter = require('eslint-detailed-reporter'),
    path = require('path'),
    fs = require('fs'),
    mkdirp = require('mkdirp');

gulp.Gulp.prototype.__runTask = gulp.Gulp.prototype._runTask;
gulp.Gulp.prototype._runTask = function (task) {
    this.currentTask = task;
    this.__runTask(task);
};

var config = require('./config/project.json'),
    jsDocConfig = require('./config/jsdoc.json');
jsDocConfig.opts.destination = path.resolve(config.application.dir.doc, 'docs');
jsDocConfig.templates.systemName = config.application.name;

var lintConfig = {
    destination: path.resolve(config.application.dir.doc, 'lint')
};

var onError = function (error) {
    try {
        var taskName = gulp.currentTask.name || 'undefined-task';
        var errorConfig = config.gulp.task[taskName] || {
            breakOnError: false
        };
        if (errorConfig.breakOnError) {
            this.emit('err');
            console.error(`ERROR: Gulp failed on task '${taskName}'. Type: '${error.name}', Message: '${error.message}'`);
            console.error(`Exit process with ${errorConfig.code}`);
            process.exit(errorConfig.code);

        } else {
            console.warn(`WARN: Gulp failed on task '${taskName}'. Type: '${error.name}', Message: '${error.message}'`);
        }
    } catch (e) {
        console.error('Error handling failed', e);
    }
    this.emit('end');
};

gulp.task('init', function () {
    var self = this;
    try {
        mkdirp.sync(jsDocConfig.opts.destination);
        mkdirp.sync(lintConfig.destination);
    } catch (e) {
        onError.call(this, e);
    }
});

gulp.task('eslint', ['init'], function () {
    var self = this;
    var esLintReport = path.resolve(lintConfig.destination, 'index.html');
    console.log('EsLint to destination:', esLintReport);

    // ESLint ignores files with "node_modules" paths.
    // So, it's best to have gulp ignore the directory as well.
    // Also, Be sure to return the stream from the task;
    // Otherwise, the task may end before the stream has finished.
    return gulp.src(config.lint.concat('!node_modules/**'))
        // eslint() attaches the lint output to the "eslint" property
        // of the file object so it can be used by other modules.
        .pipe(eslint({
            fix: true,
            extends: 'eslint:recommended',
            rules: {
                'valid-jsdoc': 'warn',
                'no-alert': 'error',
                'no-bitwise': 'off',
                'camelcase': 'warn',
                'curly': 'warn',
                'eqeqeq': 'warn',
                'no-eq-null': 'off',
                'guard-for-in': 'warn',
                'no-empty': 'warn',
                'no-use-before-define': 'off',
                'no-obj-calls': 'warn',
                'no-unused-vars': 'off',
                'new-cap': 'warn',
                'no-shadow': 'off',
                'strict': 'off',
                'no-invalid-regexp': 'error',
                'comma-dangle': 'warn',
                'no-undef': 'warn',
                'no-new': 'warn',
                'no-extra-semi': 'warn',
                'no-debugger': 'warn',
                'no-caller': 'warn',
                'semi': 'warn',
                'quotes': 'off',
                'no-unreachable': 'warn'
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

        .pipe(eslint.failAfterError())
        .on('error', onError);

});

gulp.task('jsdoc3', ['eslint'], function (done) {
    var self = this;
    console.log('JsDoc to destination:', jsDocConfig.opts.destination);
    gulp.src(['README.md', './sn/**/*.js', './sn/**/*.jsdoc'], {
            read: false
        })
        .pipe(jsdoc3(jsDocConfig, function () {
            console.log('\tdone');
            done();
        })).on('error', onError);
});

gulp.task('test', ['jsdoc3'], function (done) {
    var self = this;
    return gulp.src(['test/*.js'], {
            read: false
        })
        .pipe(mocha({
            reporter: 'mochawesome', // 'xunit' 'spec'
            reporterOptions: {
                reportDir: path.resolve(config.application.dir.doc, 'test'),
                reportFilename: 'index.html',
                reportTitle: `${config.application.name} - ${config.updateSet.name}`,
                reportPageTitle: 'ATF Results',
                quiet: true,
                json: true,
                inline: false,
                code: false
            },
            timeout: 30000,
            delay: true
        })).on('error', onError);
});

/*
    mocha report as XML
*/
gulp.task('test-xunit', ['jsdoc3'], function () {
    return gulp.src(['test/*.js'], {
            read: false
        })
        .pipe(mocha({
            reporter: 'xunit', // 'xunit' 'spec'
            reporterOptions: {
                output: path.resolve(config.application.dir.doc, 'mocha-report.xml')
            },
            timeout: 30000,
            delay: true
        })).on('error', onError);
});

gulp.task('build', ['test'], function () {});

gulp.task('default', ['build'], function () {

});


/* 
// NOTES

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
