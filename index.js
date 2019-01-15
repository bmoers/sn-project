// -W083

var Promise = require('bluebird'),
    fs = Promise.promisifyAll(require("fs-extra")),
    path = require("path");

var pfile = require('./lib/project-file');
var sanitizeFileName = require("sanitize-filename"),
    assign = require('object-assign-deep'),
    crypto = require('crypto'),
    copy = require('recursive-copy');

var Datastore = require('nedb'),
    defaultFields = ['sys_scope.name','sys_scope.scope', 'sys_scope', 'sys_class_name', 'sys_created_by', 'sys_created_on', 'sys_customer_update', 'sys_id', 'sys_mod_count', 'sys_name', 'sys_package', 'sys_policy', 'sys_replace_on_upgrade', 'sys_updated_by', 'sys_updated_on', 'sys_update_name'];

const sanitize = (value) => {
    return sanitizeFileName(value).replace(/\s{2,}/g, " ");
};
    
const deleteRecord = function (record) {
    var self = this;
    return Promise.try(() => {
        if (!record) {
            console.warn(`no record specified`);
            return;
        }
        // remove the branch name from the file record
        if (record.branch[self.config.branch]) {
            delete record.branch[self.config.branch];
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
    })
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
        branch : 'master',
        defaultFields: defaultFields,
        sysFieldWhiteList: undefined
    }, options, {
            dbFileName : false
    });
    
    if (Array.isArray(self.config.sysFieldWhiteList))
        console.log(`Using SYS_* Field White-List '${self.config.sysFieldWhiteList.join(', ')}'`);

    self.config.dir = path.resolve(self.config.dir);

    self.db = (() => {
        if (datastore) {
            console.log("Project Datastore: use remote");
            self.config.dbFileName = 'remote';
            return datastore;
        }

        console.log("Project Datastore: use local");
        self.config.dbFileName = path.join(self.config.dir, 'config', `${self.config.dbName}.db`);

        const dataStore = new Datastore({
            filename: self.config.dbFileName,
            autoload: true
        });
        dataStore.ensureIndex({ fieldName: 'branch' });
        Promise.promisifyAll(dataStore);
        return dataStore;
    })();
    
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

SnProject.prototype.install = function () {
    var self = this;

    var spawn = require('child_process').spawn;
    var os = require('os');

    var childProcess = spawn((os.platform() === 'win32' ? 'npm.cmd' : 'npm'), ['install'], {
        cwd: self.config.dir,
        detached: false,
        env: assign({}, process.env, { NODE_ENV: 'development'})
    });

    return new Promise(function (resolve, reject) {

        console.log("install node app in", self.config.dir);

        var log = '';
        childProcess.stdout.on('data', function (buff) {
            log += buff.toString().replace(/\n+/, '\n');
        });
        childProcess.stderr.on('data', function (buff) {
            log += buff.toString().replace(/\n+/, '\n');
        });

        childProcess.on('exit', function (code) {
            console.log(`npm install process exited with code: ${code}`);
            if (code > 0) {
                return reject({
                    failed: true,
                    log: log
                });
            }
            resolve({
                failed: false,
                log: log
            });
        });

    });
};


SnProject.prototype.build = function () {
    var self = this;
    var spawn = require('child_process').spawn;
    var os = require('os');

    var childProcess = spawn((os.platform() === 'win32' ? 'npm.cmd' : 'npm'), ['run-script', 'build'], { // build
        cwd: self.config.dir,
        detached: false,
        env: process.env
    });

    return new Promise(function (resolve, reject) {

        console.log("build and test from", self.config.dir);

        var log = '';
        childProcess.stdout.on('data', function (buff) {
            log += buff.toString().replace(/\n+/, '\n');
        });
        childProcess.stderr.on('data', function (buff) {
            log += buff.toString().replace(/\n+/, '\n');
        });

        childProcess.on('exit', function (code) {
            console.log(`build process exited with code: ${code}`);
            if (code > 0) {
                return reject({
                    failed: true,
                    log: log
                });
            }
            resolve({
                failed: false,
                log: log
            });
        });
    });

};

SnProject.prototype.cleanUp = function () {
    const self = this;
    const cleanDir = [path.resolve(self.config.dir, 'node_modules')];
    return Promise.each(cleanDir, (dir) => {
        console.log("deleting ", dir);
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

    console.log("Project setup");

    /*
        create all additional directories
    */
    return Promise.each(directories, function (directory) {
        console.log("Create directory '%s", directory);
        return pfile.mkdirpAsync(directory);
    }).then(function () {
        
        /* 
            copy all directories
        */
        return Promise.each(copyDir, function (copyDir) {
            console.log("Copy Directory Fom '%s', to '%s'", copyDir.from, copyDir.to);
            return copy(copyDir.from, copyDir.to, {
                overwrite: false
            }).catch(() => {
                console.log("Folder copy failed. Will slow down the build process but auto fixed with npm install.");
            });
        });
        
    }).then(function () {
        /* 
            copy all config files
        */
        return Promise.each(copyFiles, function (copyFile) {
            console.log("Copy File Fom '%s', to '%s'", copyFile.from, copyFile.to);
            return pfile.copyFileAsync(copyFile.from, copyFile.to, { overwrite: true });
        });
    }).then(function () {

        /*
            create and configure a package.json file
        */
        return fs.readFileAsync(path.resolve(self.config.templateDir, 'package.json'), 'utf8').then(function (text) {
            var packageDefinition = JSON.parse(text);
            var packageName = self.config.appName.toLowerCase();
            packageDefinition.name = '@'.concat(self.config.organization).concat('/').concat(packageName.replace(/\s+/g, "-").replace(/(?:^[\.|_])|[^a-z0-9\-\._~]/g, '').replace(/\-+/g, '-'));
            return packageDefinition;
        }).then(function (packageDefinition) {
            console.log("package.json created:", path.join(self.config.dir, 'package.json'));
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
                query[`branch.${branchName}`] = { $exists: true }
            });
        } else {
            query[`branch.${branch}`] = { $exists: true }
        }
    }
    return self.db.findAsync(query).then((res) => {
        if (!res)
            return [];
        return res.map((suite) => ({className, sysId: suite._id }));
    });
};

SnProject.prototype.getTests = function (branch) {
    const self = this;
    const className = 'sys_atf_test';
    const query = {
        className
    };
    
    if (branch) {
        if (Array.isArray(branch)){
            branch.forEach((branchName) => {
                query[`branch.${branchName}`] = { $exists: true }
            });
        } else {
            query[`branch.${branch}`] = { $exists: true }
        }
    }
    return self.db.findAsync(query).then((res) => {
        if (!res)
            return [];
        return res.map((test) => ({ className, sysId: test._id }));
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
                query[`branch.${branchName}`] = { $exists: true }
            });
        } else {
            query[`branch.${branch}`] = { $exists: true }
        }
    }
    return self.db.findAsync(query).then((res) => {
        if (!res)
            return [];
        return res.map((step) => ({ className, sysId: step._id }));
    });
};

/*
SnProject.prototype.getFileBySysId = function (sysId) {
    var self = this;
    return self.db.findOneAsync({ _id: sysId });
};

SnProject.prototype.deleteFileBySysId = function (sysId) {
    var self = this;
    return self.db.removeAsync({ _id: sysId });
};
*/

SnProject.prototype.getRecordById = function (_id) {
    var self = this;
    return self.db.findOneAsync({ _id });
};

SnProject.prototype.deleteRecordById = function (_id) {
    var self = this;
    return self.db.findOneAsync({_id}).then((record) => {
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
    
    return self.db.findAsync({ [`branch.${branchName}`] : { $exists: true }}).then((filesInBranch) => {
        console.log(`Deleting branch '${branchName}'. removing '${filesInBranch.length}' files from branch.`)
        return Promise.each(filesInBranch, (record) => {
            return deleteRecord.call(self, record);
        });
    });  
};

SnProject.prototype.writeFile = function (filePath, content, options) {  
    const self = this;
    const file = (Array.isArray(filePath)) ? path.join.apply(null, [self.config.dir].concat(filePath)) : path.join(self.config.dir, filePath);
    //console.log("write to ", file);
    return pfile.writeFileAsync(file, content, options).then(()=> file);
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
}

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
            fieldNameSplit = /\!=|\>|\>=|\<|\<=|=|IN|STARTSWITH|ENDSWITH|CONTAINS|DOESNOTCONTAIN|LIKE/;

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
SnProject.prototype.remove = function (removeSysIds, callback) {
    var self = this;
    // find all existing which are marked to be deleted
    //console.log("Removing", removedSysId);
    return self.db.findAsync({
        _id: { $in: removeSysIds },
        [`branch.${self.config.branch}`]: { $exists: true }
    }).then(function (records) {

        var removedFilesFromDisk = [];

        return Promise.each(records, function (record) {

            // delete all fields of this sys_id in this branch
            return Promise.each(record.branch[self.config.branch].fields || [], (field) => {
                var fieldFileOsPath = path.join.apply(null, [self.config.dir].concat(field.filePath));
                return Promise.try(function () {
                    if (callback) {
                        return callback(fieldFileOsPath);
                    } else {
                        return pfile.deleteFileAsync(fieldFileOsPath);
                    }
                }).then(function (deleted) {
                    if (deleted) {
                        console.log('file successfully deleted %s', fieldFileOsPath);
                        return deleteRecord.call(self, record).then(function () {
                            removedFilesFromDisk.push(fieldFileOsPath);
                        });
                    } else {
                        console.warn(`remove: file delete failed, file not found : ${fieldFileOsPath}`)
                    }
                }).then(function () {
                    return pfile.deleteEmptyDirUpwards(fieldFileOsPath);
                });
            }).then(function () {
                return removedFilesFromDisk;
            });
        });
    });
};

/**
 * Remove all records from DB and file system, which are NOT in the provided list.
 * 
 * @property {Array} allSysIds the records which have to stay
 * @property {function} callback optional function to delete the file (e.g. git.delete())
 * @returns {Array} the removed files
 */
SnProject.prototype.removeMissing = function (remainSysIds, callback) {
    var self = this;
    return self.db.findAsync({
        _id: { $nin: remainSysIds },
        [`branch.${self.config.branch}`]: { $exists: true }
    }).then(function (records) {

        var removedFilesFromDisk = [];

        //console.log("Files in DB but not in the response: ", records);
        return Promise.each(records, function (record) {
            
            // delete all fields of this sys_id in this branch
            return Promise.each(record.branch[self.config.branch].fields || [], (field) => {
                var fieldFileOsPath = path.join.apply(null, [self.config.dir].concat(field.filePath));
                return Promise.try(function () {
                    if (callback) {
                        return callback(fieldFileOsPath);
                    } else {
                        return pfile.deleteFileAsync(fieldFileOsPath);
                    }
                }).then(function (deleted) {
                    if (deleted) {
                        return deleteRecord.call(self, record).then(function () {
                            removedFilesFromDisk.push(fieldFileOsPath);
                        });
                    } else {
                        console.warn(`removeMissing: file delete failed, file not found : ${fieldFileOsPath}`)
                    }
                }).then(function () {
                    return pfile.deleteEmptyDirUpwards(fieldFileOsPath);
                }); 
            });
            
        }).then(function () {
            return removedFilesFromDisk;
        });
        
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
    const sysId = file.sys_id.value || file.sys_id;

    const updatedByField = file.sys_updated_by || file.sys_created_by || 'system';
    const updatedBy = file.____.updatedBy || updatedByField.display_value || updatedByField.value || updatedByField;

    let updatedOn = file.____.updatedOn || file.sys_updated_on.value || file.sys_updated_on || file.sys_created_on.value || file.sys_created_on || -1;
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
                }, () => {
                    return self.db.findOneAsync({
                        [`branch.${self.config.branch}.fields.filePath`]: filePath,
                        _id: { $ne: sysId }
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
                }, true);

            }).then(() => { // add the file with unique filename
                fileObjectArray.push(fileObject)
            });
        }

        const convert = (text) => {
            if (text === undefined || text === null)
                return text;

            if (typeof text == "object") {
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
            if (textL === "true" || textL === true)
                return true;
            if (textL === "false" || textL === false)
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
                if (key.indexOf(".") !== -1 || 'sys_tags' == key) {
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
                    })
                })
            });
        }

        const entity = self.getEntity(className);
        const entityQueryMatch = conditionPass(entity, file);

        let entityFileUUID;
        let jsDoc;

        return Promise.try(function () {
            if (entityQueryMatch) {
                var entityFullName = entity.name;
                
                entityFileUUID = fileUUID.concat(entityFullName);
                const jsDocFileUUID = path.join.apply(null, [self.config.dir].concat(entityFileUUID, className.concat('.jsdoc')));

                var keyValue = _substituteField.call(self, entity.key, file) || '{undefined name}';
                var subFolder = (entity.subDirPattern) ? _substituteField.call(self, entity.subDirPattern, file).replace(/^\/|\/$/g, '') : null;
                if (subFolder) {
                    // append the subFolder structure to the path
                    entityFileUUID = entityFileUUID.concat(subFolder.split(/\/|\\/))
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
                        id: `JSON`,
                        fileName,
                        fileUUID: entityJsonFileUUID,
                        body: JSON.stringify(flattenFile(jsonFile) , null, 2),
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
                            })
                            if (fileObject)
                                jsonFile[key] = {
                                    ____see: path.join.apply(null, fileObject.fileUUID)
                                }
                        }
                    });
                }

                // sanitize all path segments
                jsonFileUUID = jsonFileUUID.map((val) => sanitize(val));
                return add({
                    id: `JSON`,
                    fileName,
                    fileUUID: jsonFileUUID,
                    body: JSON.stringify(flattenFile(jsonFile) , null, 2),
                    hash: crypto.createHash('md5').update(updatedOn.toString()).digest('hex'),
                    comments: null,
                    updatedBy,
                    updatedOn
                });
            }
        }).then(() => {
            return { fileObjectArray, jsDoc };
        });
    }).then(({ fileObjectArray, jsDoc }) => { // create jsDoc file
        return new Promise.try(function () {
            if (!jsDoc || !jsDoc.file)
                return;
            return pfile.exists(jsDoc.file).then(function (exists) {
                if (exists)
                    return;
                return pfile.writeFileAsync(jsDoc.file, jsDoc.body).then(() => {
                    filesOnDisk.push({
                        _id: jsDoc.file,
                        sysId: `${sysId}.JSCDOC`,
                        path: jsDoc.file,
                        updatedBy,
                        modified: true
                    });
                });
            });
        }).then(() => fileObjectArray);
        
    }).then((fileObjectArray) => {
        return self.db.findOneAsync({
            _id: sysId
        }).then((entityCache) => {
            if (!entityCache){
                entityCache = {
                    _id: sysId,
                    className,
                    appName,
                    branch: {
                        [self.config.branch]: {
                            updatedBy,
                            updatedOn,
                            fields: []
                        }
                    }
                };
            }
            if (!entityCache.branch[self.config.branch])
                entityCache.branch[self.config.branch] = {
                    updatedBy,
                    updatedOn,
                    fields: []
                };
            return { entityCache, fileObjectArray };          
        });

    }).then(({ entityCache, fileObjectArray}) => {
        
        const branchObject = entityCache.branch[self.config.branch];
        
        return Promise.each(fileObjectArray, function (fileObject) {

            const filePath = path.join.apply(null, fileObject.fileUUID);
            const cachedField = branchObject.fields.find((field) => {
                return (field.id == fileObject.id)
            });
            
            return new Promise.try(() => { // ensure the file-name is unique
                
                if (!cachedField) // file not in db yet
                    return;
                
                if (cachedField.filePath != filePath) { // the filePath has changed
                    const from = path.join.apply(null, [self.config.dir].concat(cachedField.filePath));
                    const to = path.join.apply(null, [self.config.dir].concat(filePath));
                    
                    console.log(`\t\tRename file \n\t\t\tfrom '${from}' \n\t\t\tto   '${to}'`);
                    return pfile.move(from, to).then(() => {
                        cachedField.name = fileObject.fileName;
                        cachedField.filePath = filePath;
                    }).then(() => {
                        //console.log("Delete empty directory ", from);
                        return pfile.deleteEmptyDirUpwards(from);
                    }).then(() => {
                        return self.db.updateAsync({ _id: entityCache._id }, { $set: { [`branch.${self.config.branch}.fields`]: branchObject.fields } }, { upsert: true });
                    });
                }
            
            }).then(() => { // write the file on disk
                
                //var fieldFileOsPath = path.join.apply(null, [self.config.dir].concat(fileObject.fileUUID));
                var fieldFileOsPath = path.join(self.config.dir, filePath);
                return pfile.exists(fieldFileOsPath).then(function (exists) {

                    if (exists && cachedField && cachedField.hash == fileObject.hash) {
                        
                        // the file has not changed, return here
                        console.log("\t\tfile has not changed, skip '%s'", filePath);
                        // update the branch information 
                        cachedField.updatedOn = fileObject.updatedOn;
                        return self.db.updateAsync({ _id: entityCache._id }, { $set: { [`branch.${self.config.branch}.fields`]: branchObject.fields } }, { upsert: true }).then(() => {
                            return false;
                        });   
                    }

                    const fieldObject = cachedField || {};
                    if (!cachedField) {
                        branchObject.fields.push(fieldObject);
                    }
                    fieldObject.id = fileObject.id;
                    fieldObject.hash = fileObject.hash;
                    fieldObject.filePath = filePath
                    fieldObject.name = fileObject.fileName;

                    return pfile.writeFileAsync(fieldFileOsPath, fileObject.body).then(function () {
                        console.log("\t\tadd file '%s'", fieldFileOsPath);
                        return self.db.updateAsync({ _id: entityCache._id }, entityCache, { upsert: true });
                    }).then(() => {
                        return true;
                    });
                    
                }).then(function (modified) {
                    filesOnDisk.push({
                        _id: fileObject.fileName,
                        sysId: sysId,
                        path: fieldFileOsPath,
                        updatedBy: fileObject.updatedBy,
                        modified: modified
                    });
                });
            });
        });
    }).then(function(){
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
                    substituteString = substituteString.replace(wholeKey, alternative.replace(/\'/g, ''));
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
