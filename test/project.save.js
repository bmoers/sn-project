const os = require('os');
const fs = require('fs-extra');

const testDir = `${os.tmpdir()}/sn-project-test`;

var Snproject = require('../index');

(async () => {
    console.log(`cleaning ${testDir}`);
    await fs.emptyDir(testDir);

    const project = new Snproject({
        dir: testDir,
        appName: 'TestApp',
        dbName: 'TestDb',
        organization: 'TestOrg',
        allEntitiesAsJson: true,

    });

    for (var i = 0; i < 10; i++) {

        const id = Math.random();

        let file = {
            sys_id: `${Math.random()}_ID`,
            name: 'sample',
            api_name: 'script_name_' + id,
            script: 'function bla() { return \'tst\' }',
            active: true,
        };

        file = project.appendMeta(file, {
            hostName: 'https://localhost',
            className: 'sys_script_include',
            appName: 'dummy app',
            scopeName: 'dummy scope',
            updatedBy: 'test process',

        });
    
        console.log(await project.save(file));

        // change the id but keep the name to test rename
        file.sys_id = `${Math.random()}_ID`;
        console.log(await project.save(file));
    }

    //await fs.emptyDir(testDir);

})();
