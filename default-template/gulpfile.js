require('dotenv').config();

const gulp = require('gulp');
const jsdoc3 = require('gulp-jsdoc3');
const mocha = require('gulp-mocha');
const eslint = require('gulp-eslint');
const reporter = require('eslint-detailed-reporter');
const path = require('path');
const fs = require('fs-extra');
const archiver = require('archiver');
const uui = require('uuid/v4');
const rp = require('request-promise');

const port = (process.env.CICD_WEB_HTTPS_PORT) ? process.env.CICD_WEB_HTTPS_PORT : process.env.CICD_WEB_HTTP_PORT || 8080;
const hostName = `${(process.env.CICD_WEB_HTTPS_PORT) ? 'https' : 'http'}://${process.env.CICD_WEB_HOST_NAME || 'localhost'}:${port}`;

const Git = require('sn-cicd/lib/git');

const ROUTE_BUILD_COMPLETE = '/build/complete';
const ROUTE_TASK_COMPLETE = '/build/task';
const ROUTE_BUILD_CONFIG = '/build/config';

let config = {};
let taskError;

const git = new Git({
    dir: path.resolve(__dirname)
});

const rpd = rp.defaults({
    json: true,
    baseUrl: hostName,
    gzip: true,
    strictSSL: false,
    proxy: false,
    encoding: "utf8",
    headers: {
        'x-access-token': process.env.CICD_BUILD_ACCESS_TOKEN
    }
});


const onError = function (error) {
    taskError = error;
    //console.log(error);
    this.emit('end');
};

const buildDone = function () {
    //console.log("buildDone"); //, task, commitId);
    return rpd.post({
        url: ROUTE_BUILD_COMPLETE, body: config
    }).then((results) => {
        console.log('Build Done:', results);
    });
};


const uploadResults = function ({commitId, zip, task, testPass}) {
    /*console.log("Upload Results", {
        commitId: commitId,
        task: task,
        testPass: testPass ? 'true':'false'
    }); //, task, commitId);
    */
    return rpd.post({
        url: ROUTE_TASK_COMPLETE, formData: {
            zip: zip,
            data: JSON.stringify({
                commitId: commitId,
                task: task,
                testPass: testPass
            })
        }
    }).then((results) => {
        console.log("Upload Results", task, 'Upload successful!  Server responded with:', results);
    });
};

const taskStart = ({task}) => {
    console.log(`### Starting Task '${task}'`);
    taskError = undefined;
};

const taskStop = ({ task }) => {

    console.log(`### Task Ended '${task}'`);

    const taskConfig = config[task];
    if (!taskConfig) {
        console.warn(`No config found for task '${task}'`);
        return;
    }
    if (taskError)
        console.warn(`WARN: Gulp failed on task '${task}'. Type: '${taskError.name}', Message: '${taskError.message}'`);

    taskConfig.task = task;
    taskConfig.testPass = (taskError) ? false : true;
        
    return zip(taskConfig).then((zipFile) => {
        return uploadResults({
            zip: fs.createReadStream(zipFile),
            commitId: config.commitId,
            task: taskConfig.task,
            testPass: taskConfig.testPass
        }).then(() => {
            console.log(`Remove file '${zipFile}'`);
            return fs.remove(zipFile);
        });
    }).then(() => {
        console.log(`Remove file '${taskConfig.dir}'`);
        return fs.remove(taskConfig.dir);
    }).catch((e) => {
        console.error(e.message || e);
    });
};

const zip = function ({dir, task}) {
    return new Promise((resolve, reject) => {
        if (!dir)
            reject(`Gulp task '${task}' has no directory`);
        
        const output = fs.createWriteStream(path.join(dir, '../', `${task}.zip`));
        output.on('close', function () {
             console.log("ZIP:", task, archive.pointer() + ' total bytes');
             console.log("ZIP:", task, 'archiver has been finalized and the output file descriptor has closed.');
             resolve(path.join(dir, '../', `${task}.zip`));
        });
        
        const archive = archiver('zip', {
             zlib: {
                 level: 9
             }
        });
        archive.pipe(output);

        console.log("ZIP:", task, "adding folder ", dir);

        archive.directory(dir, false);
        archive.finalize();
    });
 
};


gulp.on('task_start', taskStart);
gulp.on('task_stop', taskStop);
/*

gulp.on('err', function (e) {
    console.log('err', e);
});
gulp.on('task_err', function (e) {
    console.log('task_err', e);
});
*/
gulp.task('default', function () {

    console.log(`\n${'* '.repeat(42)}\n\tCICD Endpoint: ${hostName}\n${'* '.repeat(42)}\n`);

    /*  TODO:
        how to get the config if git is not used ??
    */
    return git.getLastCommitId().then((commitId) => {
        //console.log('commitId', commitId);
        return rpd.get(`${ROUTE_BUILD_CONFIG}/${commitId}`).then((buildConfig) => ({
            commitId: commitId, buildConfig: buildConfig
        }));
    }).then(({commitId, buildConfig}) => {
    
        config = buildConfig;
        config.commitId = commitId;

        const tempDir = require('os').tmpdir();
        const uuid = uui();
        
        config.tempDir = path.join(tempDir, uuid);
        config.lint.dir = path.join(tempDir, uuid, 'lint');
        config.doc.dir = path.join(tempDir, uuid, 'doc');
        config.test.dir = path.join(tempDir, uuid, 'test');

        //console.log(config);
        
        gulp.task('init', function () {

            try {
                fs.mkdirpSync(config.doc.dir);
                fs.mkdirpSync(config.lint.dir);
                fs.mkdirpSync(config.test.dir);
            } catch (e) {
                onError.call(this, e);
            }
        });

        gulp.task('lint', ['init'], function () {
            var self = this;
            var esLintReport = path.resolve(config.lint.dir, 'index.html');
            console.log('EsLint to destination:', esLintReport);

            // ESLint ignores files with "node_modules" paths.
            // So, it's best to have gulp ignore the directory as well.
            // Also, Be sure to return the stream from the task;
            // Otherwise, the task may end before the stream has finished.
            return gulp.src(config.lint.files.concat('!node_modules/**'))
                // eslint() attaches the lint output to the "eslint" property
                // of the file object so it can be used by other modules.
                .pipe(eslint(config.lint.config))
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

        gulp.task('doc', ['lint'], function (done) {
            config.doc.config.opts.destination = config.doc.dir;
            console.log('JsDoc to destination:', config.doc.config.opts.destination);
            gulp.src(['README.md', './sn/**/*.js', './sn/**/*.jsdoc'], {
                    read: false
                })
                .pipe(jsdoc3(config.doc.config, function () {
                    done();
                })).on('error', onError);
        });

        gulp.task('test', ['doc'], function (done) {
            var self = this;
            return gulp.src(['test/*.js'], {
                    read: false
                })
                .pipe(mocha({
                    reporter: 'mochawesome', // 'xunit' 'spec'
                    reporterOptions: {
                        reportDir: config.test.dir,
                        reportFilename: 'index.html',
                        reportTitle: config.test.title,
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

        gulp.task('build', ['test'], buildDone);

    }).then(() => {
        gulp.start('build');
    });

});