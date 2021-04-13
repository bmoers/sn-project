

var Promise = require('bluebird');
var Snproject = require('../index');
var project = new Snproject({
    dir: 'C:\\cicd\\user-test-20',
    appName: 'TestApp',
    dbName: 'TestDb',
    organization: 'TestOrg'
});

Promise.try(() => {
    return project.build(false);
}).then((m) => {
    console.log('installed', m.log);
    return m;
}).catch((e) => {
    console.log('ERROR', e);
}).then(() => {
    console.log('End');
    return true;
});
