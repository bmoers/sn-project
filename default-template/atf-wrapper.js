const chai = require("chai");
const expect = chai.expect;
const assert = chai.assert;
const path = require('path');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require("fs"));
const addContext = require('mochawesome/addContext');
const rp = require('request-promise');

const promiseFor = Promise.method(function (condition, action, value) {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});


const port = (process.env.CICD_WEB_HTTPS_PORT) ? process.env.CICD_WEB_HTTPS_PORT : process.env.CICD_WEB_HTTP_PORT || 8080;
const hostName = `${(process.env.CICD_WEB_HTTPS_PORT) ? 'https' : 'http'}://${process.env.CICD_WEB_HOST_NAME || 'localhost'}:${port}`;

const Git = require('sn-cicd/lib/git');

const rpd = rp.defaults({
    json: true,
    baseUrl: hostName,
    gzip: true,
    strictSSL: false,
    proxy: false,
    encoding: "utf8"
});

const git = new Git({
    dir: path.resolve(__dirname, '../')
});

describe("Execute ATF: Wrapper", function () {
    return git.getLastCommitId().then((commitId) => {
        //console.log('commitId', commitId);
        const sleepMs = 1000;

        return promiseFor(function (nextOptions) {
            return (nextOptions);
        }, (options) => {
            console.log('Request: ', options.url);
            return rpd.post(options).then((response) => {
                let location;
                if (response.statusCode === 202) { // job created, come back to url
                    location = response.headers.location;
                    if (!location)
                        throw Error('Location header not found');

                    options.method = 'GET';
                    options.url = location;

                    return options;
                }

                options = null;
                body = response.body;

            }).catch((e) => {
                let location;
                if (e.statusCode === 304) {
                    location = e.response.headers.location;
                    if (!location)
                        throw e;

                    delete options.body;
                    options.method = 'GET';
                    options.url = location;

                    //console.log(`Redirect to: ${options.url}`);
                    console.log(`Job in progress. Wait for ${sleepMs} ms ...`);
                    return Promise.delay(sleepMs).then(() => {
                        return options;
                    });
                } else {
                    throw e;
                }
            });
        }, {
            followRedirect: false,
            method: 'POST',
            url: 'run_test',
            body: {
                commitId: commitId
            }
        }).then(function () {
            return body.result;
        });

    }).then((results) => {

        results.suiteResults.forEach((testExecutionResult) => {
            describe(`Test-Suite Result: "${testExecutionResult.number}"`, function () {

                it('Test-Suite Overall Result', function (done) {
                    addContext(this, testExecutionResult.url);
                    expect(testExecutionResult.status).to.equal('success');
                    done();
                });

                (testExecutionResult.testResults || []).forEach(function (testResult) {

                    describe(`Test Result: "${testResult.number}"`, function () {
                        testResult.stepResults.forEach(function (stepResult) {
                            it(`${stepResult.order} : ${stepResult.startTime} - ${stepResult.step}`, function (done) {
                                addContext(this, stepResult.url);
                                expect(stepResult.status).to.equal('success');
                                done();
                            });
                        });
                    });
                });

            });
        });
        results.testResults.forEach((testExecutionResult) => {
            describe(`Test Result: "${testExecutionResult.number}"`, function () {
                testExecutionResult.stepResults.forEach(function (stepResult) {
                    it(`${stepResult.order} : ${stepResult.startTime} - ${stepResult.step}`, function (done) {
                        addContext(this, stepResult.url);
                        expect(stepResult.status).to.equal('success');
                        done();
                    });
                });
            });
        });
        
    }).catch(function (e) {

        var message = e.error ? e.error.error ? e.error.error.message : e.error.message : e.message || 'no message';

        describe('Execute ATF: RuntimeError ', function () {
            it('Failed with', function (done) {
                console.error(message);
                expect.fail(0, 1, message); // force fail
                done();
            });
        });

    }).then(function () {
        console.log("execute Mocha Tests...");
        run();
    });
});
