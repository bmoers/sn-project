// -W083

var Promise = require('bluebird'),
    fs = require('fs-extra'),
    path = require('path');

var pfile = require('./lib/project-file');
var sanitizeFileName = require('sanitize-filename'),
    assign = require('object-assign-deep'),
    crypto = require('crypto'),
    copy = require('recursive-copy');

var Datastore = require('@moers/nedb'),
    defaultFields = ['sys_scope.name', 'sys_scope.scope', 'sys_scope', 'sys_class_name', 'sys_created_by', 'sys_created_on', 'sys_customer_update', 'sys_id', 'sys_mod_count', 'sys_name', 'sys_package', 'sys_policy', 'sys_replace_on_upgrade', 'sys_updated_by', 'sys_updated_on', 'sys_update_name'];

const sanitize = (value) => {
    return sanitizeFileName(value).replace(/\s{2,}/g, ' ');
};

const deleteRecord = function (record, branchName) {
    var self = this;
    return Promise.try(async () => {
        if (!record) {
            console.warn('no record specified');
            return;
        }

        branchName = branchName || self.config.branch;

        // remove the branch name from the file record
        if (record.branch[branchName]) {
            await self.removeFromCache(record.branch[branchName]);
            delete record.branch[branchName];
        }

        if (Object.keys(record.branch).length === 0) {
            // only remove from db if not in any other branch 
            //console.log('deleteRecord', 'remove', { _id: record._id })
            return self.db.removeAsync({ _id: record._id });
        } else {
            //console.log('deleteRecord', 'update', record)
            // update the record information with the removed branch
            return self.db.updateAsync({ _id: record._id }, record);
        }
    });
};


/**
 * Create a new collection
 * @param {String} options.dir the directory to create the repository
 * @param {String} options.appName the application name
 * @param {Array} options.entities list of entities definition, by default taken from entities_config.json
 * @param {Boolean} options.includeUnknownEntities also dump files to disk where class not in the entities list
 **/
function SnProject(options, datastore) {
    var self = this;
    self.config = assign({
        dir: require('os').tmpdir(),
        appName: 'noname',
        dbName: 'snproject',
        entities: [],
        includeUnknownEntities: false,
        allEntitiesAsJson: false,
        organization: 'organization',
        templateDir: path.join(__dirname, 'default-template'),
        templates: [{
            source: 'README.md',
            target: 'README.md'
        }],
        defaultEntitiesFile: path.resolve(__dirname, 'config', 'entities.json'),
        branch: 'master',
        defaultFields: defaultFields,
        sysFieldWhiteList: undefined
    }, options, {
        dbFileName: false
    });

    if (Array.isArray(self.config.sysFieldWhiteList))
        console.log(`Using SYS_* Field White-List '${self.config.sysFieldWhiteList.join(', ')}'`);

    self.config.dir = path.resolve(self.config.dir);

    self.db = (() => {
        if (datastore) {
            console.log('Project Datastore: use remote');
            self.config.dbFileName = 'remote';
            return datastore;
        }

        console.log('Project Datastore: use local');
        self.config.dbFileName = path.join(self.config.dir, 'config', `${self.config.dbName}.db`);

        const localDataStore = new Datastore({
            filename: self.config.dbFileName,
            autoload: true
        });

        localDataStore.ensureIndex({ fieldName: 'branch' });
        localDataStore.ensureIndex({ filename: 'sysId' });

        Promise.promisifyAll(localDataStore);

        localDataStore.find({ sysId: { $exists: false } }, (err, records) => {
            if (err)
                return console.log('nedb id update failed with ', err);
            if (!records.length)
                return;
            console.log(`NEDB id fix. creating sysId fields for ${records.length} records`);
            records.forEach((record) => {
                // copy the _id (sysId) into the new field sysId
                localDataStore.update({ _id: record._id }, { $set: { sysId: record._id } });
            });

        });
        return localDataStore;
    })();

    self.cache = null;
    self.updateCache = async ({ fields }, sysId) => {
        if (!self.cache)
            return;
        if (!fields || !sysId)
            return;
        await Promise.each(fields, (field) => {
            self.cache[field.filePath] = sysId;
        });
    };
    self.removeFromCache = async ({ fields }) => {
        if (!self.cache)
            return;
        if (!fields)
            return;
        await Promise.each(fields, (field) => {
            delete self.cache[field.filePath];
        });
    };
    self.removeFromCacheBySysId = async (sysId) => {
        if (!self.cache)
            return;
        if (!sysId)
            return;
        const keys = Object.keys(self.cache);
        await Promise.each(keys, (key) => {
            if (self.cache[key] == sysId)
                delete self.cache[key];
        });
    };
    self.renameInCache = (from, to) => {
        if (!self.cache)
            return;
        if (!from || !to)
            return;
        if (!self.cache[from])
            return;
        self.cache[to] = self.cache[from];
        delete self.cache[from];
    };
    /**
     * @returns {Promise<Array>}
     */
    self.getCache = async () => {
        if (self.cache)
            return self.cache;

        const filesInBranch = await self.db.findAsync({ [`branch.${self.config.branch}`]: { $exists: true } });

        //console.log(`Cache :: File num: ${filesInBranch.length}; Branch: ${self.config.branch}`);

        const cache = filesInBranch.reduce((out, file) => {
            file.branch[self.config.branch].fields.forEach((field) => {
                //console.log(`Cache :: Adding ${field.filePath} : ${file.sysId}`);
                out[field.filePath] = file.sysId;
            });
            return out;
        }, {});

        self.cache = cache;
        console.log(`Cache :: refreshed for branch '${self.config.branch}'. Cache size: ${Object.keys(self.cache).length}`);

        return self.cache;
    };

    if (!self.config.entities || self.config.entities.length === 0) {
        // load default entities
        self.config.entities = JSON.parse(fs.readFileSync(self.config.defaultEntitiesFile, 'utf8'));
    }

    Object.keys(self.config.entities).forEach(function (className) {
        _copyAlias.call(self, self.getEntity(className));
    });

    //console.log('SnProject ready');
}

/*
SnProject.prototype.getDbFileName = function () {
    var self = this;
    return self.config.dbFileName;
};

SnProject.prototype.getDirectory = function () { 
    var self = this;
    return self.config.dir;
};
*/

SnProject.prototype.install = function (silent) {
    var self = this;

    var spawn = require('child_process').spawn;
    var os = require('os');

    const lockFile = path.resolve(self.config.dir, 'package-lock.json');
    // cun npm ci if lock file exist
    const command = (fs.pathExistsSync(lockFile)) ? 'ci' : 'install';

    const args = [command, (silent) ? '--silent' : '', '--no-audit', '--no-optional'];

    var childProcess = spawn((os.platform() === 'win32' ? 'npm.cmd' : 'npm'), args, {
        cwd: self.config.dir,
        detached: false,
        env: assign({}, process.env, { NODE_ENV: 'development', NO_UPDATE_NOTIFIER: 1 })
    });

    return new Promise(function (resolve, reject) {

        console.log('install node app in', self.config.dir, args);

        var stdout = '';
        var stderr = '';
        childProcess.stdout.on('data', function (buff) {
            stdout += buff.toString().replace(/\n+/, '\n');
        });
        childProcess.stderr.on('data', function (buff) {
            stderr += buff.toString().replace(/\n+/, '\n');
        });

        childProcess.on('exit', function (code) {
            console.log(`npm install process exited with code: ${code}`);
            if (code > 0) {
                return reject({
                    failed: true,
                    log: stdout.concat('\nERROR: ', stderr)
                });
            }
            resolve({
                failed: false,
                log: stdout
            });
        });

    });
};


SnProject.prototype.build = function () {
    var self = this;
    var spawn = require('child_process').spawn;
    var os = require('os');

    /*
        allow to set 'max-old-space-size' via 'CICD_BUILD_NODE_OPTIONS'.
        e.g.: CICD_BUILD_NODE_OPTIONS=--max-old-space-size=768 (512 mb by default)
        All allowed node_options: https://nodejs.org/api/cli.html#cli_node_options_options
    */
    var childProcess = spawn((os.platform() === 'win32' ? 'npm.cmd' : 'npm'), ['run-script', 'build'], { // build
        cwd: self.config.dir,
        detached: false,
        env: assign({}, process.env, {
            NO_UPDATE_NOTIFIER: 1,
            NODE_OPTIONS: process.env.CICD_BUILD_NODE_OPTIONS
        })
    });

    return new Promise(function (resolve, reject) {

        console.log('build and test from', self.config.dir);

        var stdout = '';
        var stderr = '';
        childProcess.stdout.on('data', function (buff) {
            stdout += buff.toString().replace(/\n+/, '\n');
        });
        childProcess.stderr.on('data', function (buff) {
            stderr += buff.toString().replace(/\n+/, '\n');
        });

        childProcess.on('exit', function (code) {
            console.log(`build process exited with code: ${code}`);
            if (code > 0) {
                return reject({
                    failed: true,
                    log: stdout.concat('\nERROR: ', stderr)
                });
            }
            resolve({
                failed: false,
                log: stdout
            });
        });
    });

};

SnProject.prototype.cleanUp = function () {
    const self = this;
    const cleanDir = [path.resolve(self.config.dir, 'node_modules')];
    return Promise.each(cleanDir, (dir) => {
        console.log('deleting ', dir);
        return fs.remove(dir);
    });
};

SnProject.prototype.setup = function () {
    var self = this;

    var templateDir = self.config.templateDir;
    var rootDir = self.config.dir;

    var directories = [
        path.resolve(rootDir, 'config'),
        path.resolve(rootDir, 'test')
    ];

    var copyFiles = self.config.templates.map((template) => {
        return {
            from: path.resolve(templateDir, template.source),
            to: path.resolve(rootDir, template.target)
        };
    });

    /*
        copy the current node_modules folder to the project directory.
        this will speed up the app install process.
        make sure all required modules are also in this app (package.json)
    */
    /*
    var copyDir = [{
        from: path.resolve(__dirname, 'node_modules'),
        to: path.resolve(rootDir, 'node_modules')
    }];
    */
    var copyDir = [];

    console.log('Project setup');

    /*
        create all additional directories
    */
    return Promise.each(directories, function (directory) {
        console.log('Create directory \'%s', directory);
        return pfile.mkdirpAsync(directory);
    }).then(function () {

        /* 
            copy all directories
        */
        return Promise.each(copyDir, function (copyDir) {
            console.log('Copy Directory Fom \'%s\', to \'%s\'', copyDir.from, copyDir.to);
            return copy(copyDir.from, copyDir.to, {
                overwrite: false
            }).catch(() => {
                console.log('Folder copy failed. Will slow down the build process but auto fixed with npm install.');
            });
        });

    }).then(function () {
        /* 
            copy all config files
        */
        return Promise.each(copyFiles, function (copyFile) {
            console.log('Copy File Fom \'%s\', to \'%s\'', copyFile.from, copyFile.to);
            return pfile.copyFileAsync(copyFile.from, copyFile.to, { overwrite: true });
        });
    }).then(function () {

        /*
            create and configure a package.json file
        */
        return fs.readFile(path.resolve(self.config.templateDir, 'package.json'), 'utf8').then(function (text) {
            var packageDefinition = JSON.parse(text);
            var packageName = self.config.appName.toLowerCase();
            packageDefinition.name = '@'.concat(self.config.organization).concat('/').concat(packageName.replace(/\s+/g, '-').replace(/(?:^[.|_])|[^a-z0-9\-._~]/g, '').replace(/-+/g, '-'));
            return packageDefinition;
        }).then(function (packageDefinition) {
            console.log('package.json created:', path.join(self.config.dir, 'package.json'));
            return pfile.writeFileAsync(path.join(self.config.dir, 'package.json'), JSON.stringify(packageDefinition, null, '\t'));
        });
    });
};

SnProject.prototype.getTestSuites = function (branch) {
    const self = this;
    const className = 'sys_atf_test_suite';
    const query = {
        className
    };

    if (branch) {
        if (Array.isArray(branch)) {
            branch.forEach((branchName) => {
                query[`branch.${branchName}`] = { $exists: true };
            });
        } else {
            query[`branch.${branch}`] = { $exists: true };
        }
    }
    return self.db.findAsync(query).then((res) => {
        if (!res)
            return [];
        return res.map((suite) => ({ className, sysId: suite.sysId }));
    });
};

SnProject.prototype.getTests = function (branch) {
    const self = this;
    const className = 'sys_atf_test';
    const query = {
        className
    };

    if (branch) {
        if (Array.isArray(branch)) {
            branch.forEach((branchName) => {
                query[`branch.${branchName}`] = { $exists: true };
            });
        } else {
            query[`branch.${branch}`] = { $exists: true };
        }
    }
    return self.db.findAsync(query).then((res) => {
        if (!res)
            return [];
        return res.map((test) => ({ className, sysId: test.sysId }));
    });
};

SnProject.prototype.getTestSteps = function (branch) {
    const self = this;
    const className = 'sys_atf_step';
    const query = {
        className
    };

    if (branch) {
        if (Array.isArray(branch)) {
            branch.forEach((branchName) => {
                query[`branch.${branchName}`] = { $exists: true };
            });
        } else {
            query[`branch.${branch}`] = { $exists: true };
        }
    }
    return self.db.findAsync(query).then((res) => {
        if (!res)
            return [];
        return res.map((step) => ({ className, sysId: step.sysId }));
    });
};


SnProject.prototype.getFileBySysId = function (sysId) {
    var self = this;
    return self.db.findOneAsync({ sysId: sysId });
};

SnProject.prototype.deleteFileBySysId = async function (sysId) {
    var self = this;
    await self.removeFromCacheBySysId(sysId);
    return self.db.removeAsync({ sysId: sysId });
};

SnProject.prototype.getRecordById = function (_id) {
    var self = this;
    return self.db.findOneAsync({ _id });
};

SnProject.prototype.deleteRecordById = function (_id) {
    var self = this;
    return self.db.findOneAsync({ _id }).then((record) => {
        if (!record) {
            console.warn(`no record found with id ${_id}`);
            return;
        }
        return self.deleteRecord(record);
    });
};


/**
 * Delete the branch information from the DB
 * NOT THE FILES!
 * @param {String} branch optional branch name [self.config.branch]
 * @returns {Promise}
 */
SnProject.prototype.deleteBranch = function (branch) {
    var self = this;
    const branchName = branch || self.config.branch;
    if (!branchName)
        return Promise.resolve();

    return self.db.findAsync({ [`branch.${branchName}`]: { $exists: true } }).then((filesInBranch) => {
        console.log(`Deleting branch '${branchName}'. removing '${filesInBranch.length}' files from branch.`);
        return Promise.each(filesInBranch, (record) => {
            return deleteRecord.call(self, record, branchName);
        });
    });
};
/**
 * Clone branch on DB level, no files are touched!
 * @param {Boolean} hard do a hard reset, existing branch info are replaced [true]
 * @param {String} sourceBranch the name of the source branch (master most of the time)
 * @param {String} targetBranch the name of the target branch
 */
SnProject.prototype.cloneBranch = function (hard = true, sourceBranch, targetBranch) {
    var self = this;
    const sourceBranchName = sourceBranch || self.config.master.name;
    const targetBranchName = targetBranch || self.config.branch;
    if (!sourceBranchName || !targetBranchName)
        return Promise.resolve();

    console.log(`Cloning branch '${sourceBranchName}' into '${targetBranchName}'.`);

    return self.db.findAsync({ [`branch.${sourceBranchName}`]: { $exists: true } }).then((filesInBranch) => {

        return Promise.each(filesInBranch, (file) => {
            file.branch[targetBranchName] = file.branch[sourceBranchName];
            /*
            if (hard || !file[targetBranchName]) {
                // create, replace the target branch
            } else {
                // merge the target branch
                const target = file.branch[targetBranchName]
                const source = file.branch[sourceBranchName];
                target.updatedBy = source.updatedBy;
                target.updatedOn = source.updatedOn;
                // walk all the source fields and add it to the target fields
                target.fields = source.fields.map((s) => {
                    return target.fields.find((t) => t.filePath == s.filePath && t.updatedOn > s.updatedOn) || s;
                });
            }
            */
            return self.db.updateAsync(file);
        });

    });
};

SnProject.prototype.writeFile = function (filePath, content, options) {
    const self = this;
    const file = (Array.isArray(filePath)) ? path.join.apply(null, [self.config.dir].concat(filePath)) : path.join(self.config.dir, filePath);
    //console.log("write to ", file);
    return pfile.writeFileAsync(file, content, options).then(() => file);
};

SnProject.prototype.readFile = function (...args) {
    const self = this;
    const file = path.join.apply(null, [self.config.dir].concat(args));
    //console.log("read from  ", file);
    return pfile.readFileAsync(file, 'utf8');
};


/**
 * get an entityObject by className
 *  this reads from the entities object loaded from the config file
 * 
 * @param {any} className 
 * @returns {Object} the entityObject
 */
SnProject.prototype.getEntity = function (className) {
    var self = this;
    if (!className)
        return false;

    var entity = self.config.entities[className] || false;
    if (!entity)
        return false;

    /*
        default entity structure
    */
    return assign({
        className: className,
        name: null,
        key: null,
        query: null,
        json: false,
        fields: {},
        subDirPattern: null
    }, entity);
};

SnProject.prototype.hasEntity = function (className) {
    var self = this;
    if (!className)
        return false;

    return Boolean(self.config.entities[className]);
};

SnProject.prototype.loadEntity = function (className) {
    var self = this;
    if (!className)
        return false;

    return Boolean(self.config.allEntitiesAsJson || self.config.includeUnknownEntities || self.hasEntity(className));
};

SnProject.prototype.loadJson = function () {
    const self = this;
    return Boolean(self.config.allEntitiesAsJson || self.config.includeUnknownEntities);
};

/**
 * parse an entity int to a requestArguments object
 *  this can be used to do the REST call
 * 
 * @param {any} entity 
 * @returns {Object} the enriched entityObject
 */
SnProject.prototype.getEntityRequestParam = function (className) {
    var self = this;
    if (!className)
        return;

    // define the response structure
    var requestArguments = {
        className: className,
        fieldNames: [],
        displayValue: false,
        queryFieldNames: []
    };

    var entity = self.getEntity(className);
    if (!entity) { // in case there is no such known entity
        return assign({}, requestArguments, {
            fieldNames: self.config.defaultFields.map((elementValue) => {
                return {
                    name: elementValue,
                    optional: false,
                    dv: false
                };
            })
        });
    }

    // if already processed, take form cache
    if (entity.requestArguments) {
        return entity.requestArguments;
    }

    var fieldNames = [],
        dv = false,
        elementValues = self.config.defaultFields.concat([entity.key, entity.subDirPattern]).concat(Object.keys(entity.fields)),
        queryFieldNames = [];

    if (entity.query) {
        var keyValueSplit = /\^OR|\^EQ|\^NQ|\^/,
            fieldNameSplit = /!=|>|>=|<|<=|=|IN|STARTSWITH|ENDSWITH|CONTAINS|DOESNOTCONTAIN|LIKE/;

        // add all field names from the query to the elementValues array
        queryFieldNames = entity.query.split(keyValueSplit).map(function (keyValue) {
            return keyValue.split(fieldNameSplit)[0];
        }).filter(function (elementValue, index, ar) {
            return ar.indexOf(elementValue) === index;
        });

        elementValues = elementValues.concat(queryFieldNames);
    }

    // make unique
    elementValues.filter(function (elementValue, index, ar) {
        return ar.indexOf(elementValue) === index;
    }).forEach(function (elementValue) {
        if (elementValue) {
            fieldNames = fieldNames.concat(_parseField.call(self, elementValue));
        }
    });

    dv = fieldNames.some(function (field) {
        return (field.dv);
    });


    entity.requestArguments = assign({}, requestArguments, {
        className: entity.className,
        fieldNames: fieldNames,
        displayValue: dv,
        queryFieldNames: queryFieldNames
    });

    // update the entity in the cache
    _setEntity.call(self, entity);

    return entity.requestArguments;

};

/**
 * Remove all records from DB and file system, which are IN the provided list.
 * 
 * @property {Array} removedSysId the records which have to be removed
 * @returns {Array} the removed files
 */
SnProject.prototype.remove = function (removeFiles, callback) {
    var self = this;
    var removedFilesFromDisk = [];

    const removeIdArray = Array.isArray(removeFiles) ? removeFiles : (removeFiles) ? [removeFiles] : [];
    if (removeIdArray.length === 0)
        return Promise.resolve(removedFilesFromDisk);

    //$or: [{ [`branch.${self.config.branch}`]: { $exists: true } }, { [`branch.${self.config.master.name}`]: { $exists: true } }]

    //console.log("find for removed files in ", removeIdArray.map((remove) => remove.sysId))

    // find all existing which are marked to be deleted
    return self.db.findAsync({
        sysId: { $in: removeIdArray.map((remove) => remove.sysId) }
    }).then(function (records) {
        //console.log('records found %j', records)
        return Promise.each(records, function (record) {

            return Promise.each(Object.keys(record.branch), async (branchName) => {

                const branch = record.branch[branchName];
                if (!branch || !branch.fields || !branch.fields.length)
                    return;

                await self.removeFromCache(branch);

                // delete all fields of this sys_id in this branch
                return Promise.each(branch.fields, (field) => {

                    //field.hash = '-1';

                    var fieldFileOsPath = path.join.apply(null, [self.config.dir].concat(field.filePath));
                    //console.log('delete fieldFileOsPath', fieldFileOsPath);

                    return Promise.try(function () {
                        if (callback) {
                            // external delete implementation
                            return callback(fieldFileOsPath);
                        } else {
                            return pfile.deleteFileAsync(fieldFileOsPath);
                        }
                    }).then(function (deleted) {
                        if (deleted) {
                            field.hash = '-1'; // reset the hash but dont delete the record from the DB
                            console.log('\t\tfile successfully deleted %s', fieldFileOsPath);
                            removedFilesFromDisk.push({
                                sysId: record.sysId,
                                path: fieldFileOsPath,
                                updatedBy: removeIdArray.reduce((user, file) => {
                                    return (user != undefined) ? user : (file.sysId == record.sysId) ? file.updatedBy : undefined;
                                }, undefined)
                            });
                        } else {
                            console.warn(`\t\tremove: file delete failed, file not found : ${fieldFileOsPath}`);
                        }
                    }).then(function () {
                        return pfile.deleteEmptyDirUpwards(fieldFileOsPath);
                    });
                });

            }).then(() => {
                return self.db.updateAsync({ _id: record._id }, record);
                /*
                //console.log('remainingFields', remainingFields);
                branch.fields = remainingFields;
                if (branch.fields.length === 0 || branchName == self.config.branch) { // no files for this record in this branch
                    return deleteRecord.call(self, record, branchName);
                } else {
                    // update the record information with the updated fields
                    return self.db.updateAsync({ _id: record._id }, record);
                }
                */
            });

        });
    }).then(function () {
        return removedFilesFromDisk;
    });
};

/**
 * Remove all records from DB and file system, which are NOT in the provided list.
 * 
 * @property {Array} remainSysIds the records which have to stay
 * @property {function} callback optional function to delete the file (e.g. git.delete())
 * @returns {Promise<Array>} [path] the removed files
 */
SnProject.prototype.removeMissing = function (remainSysIds, callback) {
    var self = this;
    var removedFilesFromDisk = [];

    const remainIdArray = Array.isArray(remainSysIds) ? remainSysIds : (remainSysIds) ? [remainSysIds] : [];
    /*
    if (remainIdArray.length === 0)
        return Promise.resolve(removedFilesFromDisk);
    */

    const query = {
        [`branch.${self.config.branch}`]: { $exists: true }
    };
    if (remainIdArray.length !== 0) {
        query.sysId = { $nin: remainSysIds };
    }

    return self.db.findAsync(query).then(function (records) {

        //console.log("Files in DB but not in the response: ", records);
        return Promise.each(records, function (record) {

            // delete all fields of this sys_id in this branch
            return Promise.each(record.branch[self.config.branch].fields || [], (field) => {
                var fieldFileOsPath = path.join.apply(null, [self.config.dir].concat(field.filePath));

                return pfile.exists(fieldFileOsPath).then((exists) => {
                    // only process existing files
                    if (!exists)
                        return;

                    return Promise.try(function () {
                        if (callback) {
                            return callback(fieldFileOsPath);
                        } else {
                            return pfile.deleteFileAsync(fieldFileOsPath);
                        }
                    }).then(function (deleted) {
                        if (deleted) {
                            //console.log('removeMissing: file successfully deleted %s', fieldFileOsPath);
                            removedFilesFromDisk.push(fieldFileOsPath);
                        } else {
                            console.warn(`removeMissing: file delete failed, file not found : ${fieldFileOsPath}`);
                        }
                    }).then(function () {
                        return pfile.deleteEmptyDirUpwards(fieldFileOsPath);
                    });

                });


            }).then(async () => {
                await self.removeFromCache(record.branch[self.config.branch]);
                return deleteRecord.call(self, record);
            });
        });

    }).then(function () {
        return removedFilesFromDisk;
    });
};

SnProject.prototype.appendMeta = function (file, { hostName, className, appName, scopeName, updatedBy, updatedOn }) {
    file.____ = { hostName, className, appName, scopeName, updatedBy, updatedOn };
    return file;
};


SnProject.prototype.save = function (file) {
    const self = this;
    const promiseFor = Promise.method(function (condition, action, value) {
        if (!condition(value))
            return value;
        return action(value).then(promiseFor.bind(null, condition, action));
    });

    const appName = file.____.appName;
    const scopeName = file.____.scopeName;
    const className = file.____.className;
    const sysId = (file.sys_id.value || file.sys_id).toString();

    const updatedByField = file.sys_updated_by || file.sys_created_by || 'system';
    const updatedBy = file.____.updatedBy || updatedByField.display_value || updatedByField.value || updatedByField;

    let updatedOn = file.____.updatedOn || ((file.sys_updated_on) ? file.sys_updated_on.value || file.sys_updated_on : (file.sys_created_on) ? file.sys_created_on.value || file.sys_created_on : -1);
    if (updatedOn) {
        file.____.updatedOn = updatedOn;
        updatedOn = new Date(updatedOn).getTime();
    }

    // json files might also want to have an url...
    file.____.url = `/${className}.do?sys_id=${sysId}`;

    const fileUUID = ['sn', appName];
    const filesOnDisk = [];

    return Promise.try(function () {

        const fileObjectArray = [];

        const add = (fileObject) => {
            return new Promise.try(() => { // ensure the file-name is unique
                let filePath = path.join.apply(null, fileObject.fileUUID);
                let counter = 0;
                const last = fileObject.fileUUID.length - 1;
                const fileName = fileObject.fileUUID[last];
                return promiseFor(function (next) {
                    return (next);
                }, async () => {

                    const cache = await self.getCache();
                    const fileSysId = cache[filePath];
                    if (!fileSysId) {
                        await self.updateCache({ fields: [{ filePath }] }, sysId);

                    } else if (fileSysId && fileSysId != sysId) {
                        counter++;
                        //console.warn("there is already an object with the same name but different sys_id! Renaming current file");
                        fileObject.fileUUID[last] = fileName.replace(/(\.[^.]+)$/, '_' + counter + '$1');
                        filePath = path.join.apply(null, fileObject.fileUUID);
                        //console.warn("\tto:", cacheKey);
                        return (counter < 500);
                    }
                    return false;
                    /*
                    // ****************************************
                    // this query is very very very expensive !
                    // ****************************************

                    return self.db.findOneAsync({
                        [`branch.${self.config.branch}.fields.filePath`]: filePath,
                        sysId: { $ne: sysId }
                    }).then(function (doc) {
                        if (doc) {
                            counter++;
                            //console.warn("there is already an object with the same name but different sys_id! Renaming current file");
                            fileObject.fileUUID[last] = fileName.replace(/(\.[^\.]+)$/, "_" + counter + "$1");
                            filePath = path.join.apply(null, fileObject.fileUUID);
                            //console.warn("\tto:", cacheKey);
                            return (counter < 500);
                        }
                        return false;
                    });
                    */
                }, true);

            }).then(() => { // add the file with unique filename
                fileObjectArray.push(fileObject);
            });
        };

        const convert = (text) => {
            if (text === undefined || text === null)
                return text;

            if (typeof text == 'object') {
                return Object.keys(text).reduce((out, key) => {
                    out[key] = convert(text[key]);
                    return out;
                }, {});
            }
            if (Array.isArray(text)) {
                return text.map((key) => convert(key));
            }
            const textL = text.toString().toLowerCase();
            if (textL == 'null')
                return null;
            if (textL === 'true' || textL === true)
                return true;
            if (textL === 'false' || textL === false)
                return false;
            if (text.length && !isNaN(text))
                return Number(text);

            return text;
        };

        /**
         * Flatten the JSON. Remove all display values.
         * This is to ensure the local json file does always look the same, 
         * regardless if its based on REST or Update-Set XML
         * 
         * @param {Object} file the REST response with display_value
         * @returns {Object} a copy of the file object with xml like structure
         */
        const flattenFile = (file) => {
            const whiteList = Array.isArray(self.config.sysFieldWhiteList) ? self.config.sysFieldWhiteList : [];
            const fields = (whiteList.length) ? Object.keys(file).filter((field) => {
                return (!field.startsWith('sys_') || whiteList.includes(field));
            }) : Object.keys(file);

            return fields.sort().reduce((out, key) => {
                if (key.indexOf('.') !== -1 || 'sys_tags' == key) {
                    return out;
                }
                const field = file[key];
                if (field === null) {
                    out[key] = field;
                } else {
                    out[key] = convert(field.value !== undefined ? field.value : field);
                }
                return out;
            }, {});
        };

        const conditionPass = (entity, file = {}) => {
            if (!entity)
                return false;
            if (!entity.query)
                return true;

            // "valueLIKE(^valueLIKE{^valueLIKEfunction^ORvalueLIKE}())^valueNOT LIKE<mail_script>^valueNOT LIKE</script>"
            // https://docs.servicenow.com/bundle/london-application-development/page/use/common-ui-elements/reference/r_OpAvailableFiltersQueries.html#r_OpAvailableFiltersQueries
            return entity.query.split('^NQ').some((segment) => {
                const ands = segment.split(/\^(?!OR)/);
                return ands.every((and) => {
                    const ors = and.split(/\^OR/);
                    return ors.some((or) => {
                        const op = or.split(/(!=|<=|>=|=|<|>|LIKE|CONTAINS|STARTSWITH|NOT LIKE|DOES NOT CONTAIN|IN)/);
                        const field = op[0];
                        const operator = op[1];
                        const term = decodeURI(op.slice(2).join('')); // in case the value also contains < or >
                        const valueField = file[field];

                        if (valueField === undefined)
                            return true;

                        const value = String(((valueField !== null && valueField.value !== undefined) ? valueField.value : valueField)).valueOf();
                        switch (operator) {
                        case '=':
                            return (value == term);
                        case '!=':
                            return (value != term);
                        case '<':
                            return (value < term);
                        case '>':
                            return (value > term);
                        case '<=':
                            return (value <= term);
                        case '>=':
                            return (value >= term);
                        case 'LIKE':
                            return (value.toLowerCase().includes(term.toLowerCase()));
                        case 'CONTAINS':
                            return (value.toLowerCase().includes(term.toLowerCase()));
                        case 'STARTSWITH':
                            return (value.toLowerCase().indexOf(term.toLowerCase()) === 0);
                        case 'NOT LIKE':
                            return (!value.toLowerCase().includes(term.toLowerCase()));
                        case 'DOES NOT CONTAIN':
                            return (!value.toLowerCase().includes(term.toLowerCase()));
                        case 'IN':
                            return (term.toLowerCase().split(',').map((a) => a.trim()).includes(value.toLowerCase()));
                        default:
                            return false;
                        }
                    });
                });
            });
        };

        const entity = self.getEntity(className);
        const entityQueryMatch = conditionPass(entity, file);

        let entityFileUUID;
        let jsDoc;

        return Promise.try(function () {
            if (entityQueryMatch) {
                var entityFullName = entity.name;

                entityFileUUID = fileUUID.concat(entityFullName).map((val) => sanitize(val));
                const jsDocFileUUID = path.join.apply(null, [self.config.dir].concat(entityFileUUID, className.concat('.jsdoc')));

                var keyValue = _substituteField.call(self, entity.key, file) || '{undefined name}';
                var subFolder = (entity.subDirPattern) ? _substituteField.call(self, entity.subDirPattern, file).replace(/^\/|\/$/g, '') : null;
                if (subFolder) {
                    // append the subFolder structure to the path
                    entityFileUUID = entityFileUUID.concat(subFolder.split(/\/|\\/));
                }

                if (entity.json) {
                    // know entity in JSON format

                    const extension = '.json';
                    const fileName = sysId;
                    const entityJsonFileUUID = entityFileUUID.concat(fileName.concat(extension)).map((val) => sanitize(val));

                    const jsonFile = assign({}, file);
                    if (jsonFile.____)
                        delete jsonFile.____;

                    return add({
                        id: 'JSON',
                        fileName,
                        fileUUID: entityJsonFileUUID,
                        body: JSON.stringify(flattenFile(jsonFile), null, 2),
                        hash: crypto.createHash('md5').update(updatedOn.toString()).digest('hex'),
                        comments: null,
                        updatedBy,
                        updatedOn
                    });

                } else {

                    // known entity in text format
                    var fields = entity.fields || {},
                        fieldKeys = Object.keys(fields);

                    if (fieldKeys.length > 1) {
                        // value part of the path
                        entityFileUUID = entityFileUUID.concat(keyValue);
                    }

                    entityFileUUID = entityFileUUID.map((val) => sanitize(val));

                    return Promise.each(fieldKeys, function (fieldName) {

                        var extension = fields[fieldName];
                        var value = (typeof file[fieldName] == 'object' && file[fieldName] !== null) ? file[fieldName].value : file[fieldName];

                        // only create a file if the field has value
                        if (value && value.length) {

                            if (!jsDoc) {
                                jsDoc = {
                                    file: jsDocFileUUID,
                                    body: `/**\n * ${appName} ${entityFullName}\n * @module ${className}\n * @memberof ${scopeName}\n */\n`
                                };
                            }
                            const fileName = (fieldKeys.length > 1) ? fieldName : keyValue;
                            var currentFileUUID = entityFileUUID.concat([(fileName).concat(extension)]).map((val) => sanitize(val));

                            var comments = [];
                            comments.push('Application : '.concat(appName));
                            comments.push('ClassName   : '.concat(className));
                            if (file.sys_created_on)
                                comments.push('Created On  : '.concat(file.sys_created_on.value || file.sys_created_on));
                            if (file.sys_created_by)
                                comments.push('Created By  : '.concat(file.sys_created_by.value || file.sys_created_by));
                            if (file.sys_updated_on)
                                comments.push('Updated On  : '.concat(file.sys_updated_on.value || file.sys_updated_on));
                            if (file.sys_updated_by)
                                comments.push('Updated By  : '.concat(file.sys_updated_by.value || file.sys_updated_by));

                            if (file.____.hostName)
                                comments.push('URL         : '.concat('/').concat(className).concat('.do?sys_id=').concat(sysId));

                            if (extension == '.js') {
                                value = '/* \n * '.concat(comments.join('\n * ')).concat('\n */\n').concat(value);
                            } else if ((/html$/).test(extension)) {
                                value = '<!-- \n * '.concat(comments.join('\n * ')).concat('\n-->\n').concat(value);
                            }

                            return add({
                                id: `FIELD:${fieldName}`,
                                fileName,
                                fileUUID: currentFileUUID,
                                body: value,
                                hash: crypto.createHash('md5').update(value.replace(/[\n\r]+/g, '\n')).digest('hex'),
                                comments,
                                updatedBy,
                                updatedOn
                            });
                        }

                    });
                }
            }

        }).then(() => {
            if (self.config.allEntitiesAsJson || (!entityQueryMatch && self.config.includeUnknownEntities)) {

                if (entityQueryMatch && entity.json) // dont save 2 versions of JSON
                    return;

                // save unknown entity as json on disk
                const extension = '.json';
                const fileName = sysId;
                const jsonFile = assign({}, file);
                if (jsonFile.____)
                    delete jsonFile.____;

                let jsonFileUUID = fileUUID.concat(['_', className, fileName.concat(extension)]);
                if (entity) {
                    /*
                    jsonFileUUID = entityFileUUID.concat();
                    jsonFileUUID[jsonFileUUID.length - 1] = fileName.concat(extension); 
                    */

                    // link the fields which are created as file.
                    // this prevents from 'seeing' multiple changes in the branch
                    Object.keys(entity.fields || {}).forEach((key) => {
                        if (jsonFile[key]) {
                            const fileObject = fileObjectArray.find((fileObject) => {
                                return (fileObject.id == `FIELD:${key}`);
                            });
                            if (fileObject)
                                jsonFile[key] = {
                                    ____see: path.join.apply(null, fileObject.fileUUID)
                                };
                        }
                    });
                }

                // sanitize all path segments
                jsonFileUUID = jsonFileUUID.map((val) => sanitize(val));
                return add({
                    id: 'JSON',
                    fileName,
                    fileUUID: jsonFileUUID,
                    body: JSON.stringify(flattenFile(jsonFile), null, 2),
                    hash: crypto.createHash('md5').update(updatedOn.toString()).digest('hex'),
                    comments: null,
                    updatedBy,
                    updatedOn
                });
            }
        }).then(() => {
            return { fileObjectArray, jsDoc };
        });
    }).then(async ({ fileObjectArray, jsDoc }) => { // create jsDoc file

        if (jsDoc && jsDoc.file) {
            const exists = await pfile.exists(jsDoc.file);
            if (!exists) {
                await pfile.writeFileAsync(jsDoc.file, jsDoc.body);
                filesOnDisk.push({
                    _id: jsDoc.file,
                    sysId: `${sysId}.JSCDOC`,
                    path: jsDoc.file,
                    updatedBy,
                    modified: true
                });
            }
        }

        return fileObjectArray;

    }).then(async (fileObjectArray) => {

        let entityCache = await self.db.findOneAsync({
            sysId: sysId
        });

        if (!entityCache) {
            entityCache = await self.db.insertAsync({
                sysId: sysId,
                className,
                appName,
                branch: {
                    [self.config.branch]: {
                        updatedBy,
                        updatedOn,
                        fields: []
                    }
                }
            });

        } else if (!entityCache.branch[self.config.branch]) {
            entityCache.branch[self.config.branch] = {
                updatedBy,
                updatedOn,
                fields: []
            };
        }

        return { entityCache, fileObjectArray };

    }).then(({ entityCache, fileObjectArray }) => {

        const branchObject = entityCache.branch[self.config.branch];

        return Promise.each(fileObjectArray, function (fileObject) {

            const filePath = path.join.apply(null, fileObject.fileUUID);
            const cachedField = branchObject.fields.find((field) => {
                return (field.id == fileObject.id);
            });

            let fileNameChanged = false;

            return new Promise.try(() => { // ensure the file-name is unique

                if (!cachedField) // file not in db yet
                    return;

                if (cachedField.filePath != filePath) { // the filePath has changed

                    const from = path.join(self.config.dir, cachedField.filePath);
                    const to = path.join(self.config.dir, filePath);

                    self.renameInCache(from, to);

                    return pfile.exists(from).then((exists) => {
                        if (!exists)
                            return;

                        console.log(`\t\tRename file \n\t\t\tfrom '${from}' \n\t\t\tto   '${to}'`);
                        return pfile.move(from, to).then(() => {
                            fileNameChanged = true;

                            return pfile.deleteEmptyDirUpwards(from);
                        }).catch((e) => {
                            console.warn('File rename failed', e);
                        });
                    });
                }

            }).then(async () => { // write the file on disk

                //var fieldFileOsPath = path.join.apply(null, [self.config.dir].concat(fileObject.fileUUID));
                var fieldFileOsPath = path.join(self.config.dir, filePath);

                let modified = false;
                const exists = await pfile.exists(fieldFileOsPath);

                if (exists && !fileNameChanged && cachedField && cachedField.hash == fileObject.hash) {

                    // the file has not changed, return here
                    console.log('\t\tfile has not changed, skip \'%s\'', filePath);
                    // update the branch information 
                    await self.db.updateAsync({ sysId: entityCache.sysId }, {
                        $set: {
                            [`branch.${self.config.branch}.updatedOn`]: fileObject.updatedOn,
                            [`branch.${self.config.branch}.updatedBy`]: fileObject.updatedBy,
                        }
                    }, { upsert: true });
                    // file untouched
                    modified = false;

                } else {

                    branchObject.updatedOn = fileObject.updatedOn;
                    branchObject.updatedBy = fileObject.updatedBy;

                    if (cachedField) {
                        cachedField.hash = fileObject.hash;
                        cachedField.filePath = filePath;
                        cachedField.name = fileObject.fileName;
                    } else {
                        // this is a new field
                        const fieldObject = {
                            id: fileObject.id,
                            hash: fileObject.hash,
                            filePath: filePath,
                            name: fileObject.fileName
                        };
                        branchObject.fields.push(fieldObject);
                    }

                    console.log('\t\tadd file \'%s\'', fieldFileOsPath);
                    await pfile.writeFileAsync(fieldFileOsPath, fileObject.body);

                    await self.db.updateAsync({ sysId: entityCache.sysId }, { $set: { [`branch.${self.config.branch}`]: branchObject } }, { upsert: true });

                    await self.updateCache(branchObject, entityCache.sysId);
                    // file modified
                    modified = true;

                }

                filesOnDisk.push({
                    _id: fileObject.fileName,
                    sysId: sysId,
                    path: fieldFileOsPath,
                    updatedBy: fileObject.updatedBy,
                    modified: modified
                });


            });
        });
    }).then(function () {
        return filesOnDisk;
    });
};


/**
 * check if an entity has alias classNames
 *  and create or update these alias records with the current one
 * 
 * @param {any} entity 
 */
var _copyAlias = function (entity) {
    var self = this;
    var alias = entity.alias;

    if (Array.isArray(alias)) {
        alias.forEach(function (aliasClassName) {
            var aliasEntity = self.getEntity(aliasClassName);
            if (aliasEntity) {
                // if there is already an entity with the same name
                // MERGE -- copy everything from the entity to the existingEntity
                aliasEntity.key = aliasEntity.key || entity.key || null;
                aliasEntity.query = aliasEntity.query || entity.query || null;
                aliasEntity.subDirPattern = aliasEntity.subDirPattern || entity.subDirPattern || null;
                // copy all fields to the existing one
                Object.keys(entity.fields).forEach(function (key) {
                    aliasEntity.fields[key] = entity.fields[key];
                });
                // update the alias entity
                _setEntity.call(self, aliasEntity);
                /*
                    run this again
                    in case the alias entity has again aliases
                */
                _copyAlias.call(self, aliasEntity);
            } else {
                // create the alias entity
                _setEntity.call(self, assign({}, entity, { className: aliasClassName, name: entity.name.concat('.').concat(aliasClassName), alias: null, copyOfClassName: entity.className }));
            }
        });
    }
};

/**
 * Save a entity
 *  this is not persistent!
 * 
 * @param {any} entity 
 * @returns 
 */
var _setEntity = function (entity) {
    var self = this;
    if (!entity)
        return;

    self.config.entities[entity.className] = entity;
};

/**
 *  parse field for following patterns:
 *
 *      <cat_item|variable_set> take first not null
 *      <cat_item!dv> displayValue of the field
 *      <cat_item!dv?> optional displayValue of the field
 *      <cat_variable?> optional field
 *      <table|'global'> default if empty
 * 
 * @param {any} field 
 * @returns {Array} list of fieldNames found in the entity value
 */
var _parseField = function (elementValue) {

    var fields = [],
        regex = /<([^>]+)>/g,
        m;

    // in case its a normal field e.g "name"
    if (!regex.test(elementValue)) {
        fields.push({
            name: elementValue,
            optional: false,
            dv: false
        });
    }

    // reset index to have the regex working again
    regex.lastIndex = 0;

    while ((m = regex.exec(elementValue)) !== null) {
        if (m.index === regex.lastIndex) {
            regex.lastIndex++;
        }
        var key = m[1];
        if (key !== undefined && fields.indexOf(key) == -1) {
            // split key for alternatives
            key.split('|').forEach(function (fieldName) {
                if (fieldName.indexOf('\'') === -1) {

                    var field = { name: null, optional: false, dv: false, };

                    if (fieldName.endsWith('?')) {
                        field.optional = true;
                        fieldName = fieldName.slice(0, -1);
                    }

                    if (fieldName.endsWith('!dv')) {
                        field.dv = true;
                        fieldName = fieldName.slice(0, -3);
                    }
                    field.name = fieldName;
                    fields.push(field);
                }
            });
        }
    }
    return fields;

};

var _substituteField = function (fieldValue, substituteObject) {

    if (fieldValue === undefined || fieldValue === null)
        return null;

    var regex = /<([^>]+)>/g,
        match,
        substituteString = fieldValue;

    // in case there is no need for substitution, return the field name as it is.
    if (!regex.test(fieldValue)) {
        var payloadValue = substituteObject[fieldValue];
        if (payloadValue) {
            // take the value automatically form result object or string
            return (payloadValue.value !== undefined) ? payloadValue.value : payloadValue; //((displayValue) ? payloadValue.display_value : payloadValue.value) : payloadValue; // ((displayValue) ? payloadValue.display_value : payloadValue.value) : payloadValue;
        }
        return '{--none--}';
    }

    // reset index to have the regex working again
    regex.lastIndex = 0;

    while ((match = regex.exec(fieldValue)) !== null) {
        if (match.index === regex.lastIndex) {
            regex.lastIndex++;
        }
        var key = match[1],
            wholeKey = match[0];
        if (key !== undefined) {
            // split key for alternatives

            // first alternative to match exits
            var replaced = key.split('|').some((alternative) => {

                var optional = false,
                    displayValue = false;

                if (alternative.endsWith('?')) {
                    optional = true;
                    alternative = alternative.slice(0, -1);
                }
                if (alternative.endsWith('!dv')) {
                    displayValue = true;
                    alternative = alternative.slice(0, -3);
                }

                if (alternative.indexOf('\'') === 0) {
                    // string alternative
                    substituteString = substituteString.replace(wholeKey, alternative.replace(/'/g, ''));
                    return true;

                } else {
                    // variable alternative
                    var payloadValue = substituteObject[alternative];
                    if (payloadValue !== undefined) {
                        // take the value automatically form result object or string
                        var value = (typeof payloadValue == 'object' && payloadValue !== null) ? ((displayValue) ? payloadValue.display_value : payloadValue.value) : payloadValue;
                        if (value !== undefined && value !== null) {
                            if (typeof value == 'string' && value.length === 0) // no substitution with empty string
                                return false;

                            substituteString = substituteString.replace(wholeKey, value);
                            return true;
                        }

                    } else if (optional) {
                        // this is an optional argument, replace the element from the elementValue
                        // chars like '?' in the argument text must be escaped. e.g. <gulz?>
                        substituteString = substituteString.replace(new RegExp(wholeKey.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&').concat('\/?')), '');
                        return true;
                    }
                }
            });

            if (!replaced) {
                substituteString = substituteString.replace(wholeKey, '{--none--}');
            }
        }
    }

    return substituteString;

};

module.exports = SnProject;
