// -W083

var Promise = require('bluebird'),
    fs = Promise.promisifyAll(require("fs")),
    path = require("path");

var pfile = require('./lib/project-file');
var sanitize = require("sanitize-filename"),
    ObjectAssignDeep = require('object-assign-deep'),
    crypto = require('crypto'),
    copy = require('recursive-copy');

var Datastore = require('nedb'),
    defaultFields = ['sys_scope.name','sys_scope.scope', 'sys_scope', 'sys_class_name', 'sys_created_by', 'sys_created_on', 'sys_customer_update', 'sys_id', 'sys_mod_count', 'sys_name', 'sys_package', 'sys_policy', 'sys_replace_on_upgrade', 'sys_updated_by', 'sys_updated_on', 'sys_update_name'];
    
/**
 * Create a new collection
 * @param {String} options.dir the directory to create the repository
 * @param {String} options.appName the application name
 * @param {Array} options.entities list of entities definition, by default taken from entities_config.json
 * @param {Boolean} options.includeUnknownEntities also dump files to disk where class not in the entities list
 **/
function SnProject(options) {
    var self = this;
    self.config = Object.assign({
        dir: require('os').tmpdir(),
        appName: 'noname',
        dbName: 'snproject',
        entities: [],
        includeUnknownEntities: false,
        organization: 'organization',
        templateDir: path.join(__dirname, 'default-template'),
        defaultEntitiesFile: path.resolve(__dirname, 'config', 'entities.json')
    }, options);
    
    self.config.dir = path.resolve(self.config.dir);
    self.config.dbFileName = path.join(self.config.dir, 'config', `${self.config.dbName}.db`);
    
    self.db = new Datastore({
        filename: self.config.dbFileName ,
        autoload: true
    });
    Promise.promisifyAll(self.db);

    if (!self.config.entities || self.config.entities.length === 0) {
        // load default entities
        self.config.entities = JSON.parse(fs.readFileSync(self.config.defaultEntitiesFile, 'utf8'));
    }

    Object.keys(self.config.entities).forEach(function (className) {
        _copyAlias.call(self, self.getEntity(className));
    });
    //console.log('SnProject ready');
    //console.log(self.config)
}


SnProject.prototype.getDbFileName = function () {
    var self = this;
    return self.config.dbFileName;
};

SnProject.prototype.getDirectory = function () { 
    var self = this;
    return self.config.dir;
};

SnProject.prototype.install = function () {
    var self = this;

    var spawn = require('child_process').spawn;
    var os = require('os');

    var childProcess = spawn((os.platform() === 'win32' ? 'npm.cmd' : 'npm'), ['install'], { cwd: self.config.dir, detached: false });

    return new Promise(function (resolve, reject) {

        console.log("install node app in", self.config.dir);

        var data, error;
        childProcess.stdout.on('data', function (buff) {
            data = buff.toString();
        });
        childProcess.stderr.on('data', function (buff) {
            error = buff.toString();
        });

        childProcess.once('error', function (code) {
            try {
                process.kill(childProcess.pid);
            } catch (e) {
                // console.error(e);
            }
            reject(new Error('Exited with code ' + code + '\n' + error + '\n' + data));
        });

        childProcess.once('close', function (code) {
            try {
                process.kill(childProcess.pid);
            } catch (e) {
                // console.error(e);
            }
            if (code > 0) {
                reject(new Error('Exited with code ' + code + '\n' + error + '\n' + data));
                return;
            }
            resolve(data);
        });
    });
};


SnProject.prototype.build = function () {
    var self = this;
    var spawn = require('child_process').spawn;
    var os = require('os');

    var childProcess = spawn((os.platform() === 'win32' ? 'npm.cmd' : 'npm'), ['run-script', 'build'], { cwd: self.config.dir, detached: false });

    return new Promise(function (resolve, reject) {

        console.log("build and test from", self.config.dir);

        var data, error;
        childProcess.stdout.on('data', function (buff) {
            data = buff.toString();
        });
        childProcess.stderr.on('data', function (buff) {
            error = buff.toString();
        });

        childProcess.once('error', function (code) {
            try {
                process.kill(childProcess.pid);
            } catch (e) {
                // console.error(e);
            }
            reject(new Error('Exited with code ' + code + '\n' + error + '\n' + data));
        });

        childProcess.once('close', function (code) {
            try {
                process.kill(childProcess.pid);
            } catch (e) {
                // console.error(e);
            }
            if (code > 0) {
                reject(new Error('Exited with code ' + code + '\n' + error + '\n' + data));
                return;
            }
            resolve(data);
        });
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

    var copyFiles = [{
            from: path.resolve(templateDir, 'atf-wrapper.js'),
            to: path.resolve(rootDir, 'test', 'atf-wrapper.js')
        },
        {
            from: path.resolve(templateDir, 'gulpfile.js'),
            to: path.resolve(rootDir, 'gulpfile.js')
        },
        {
            from: path.resolve(templateDir, 'jsdoc.json'),
            to: path.resolve(rootDir, 'config', 'jsdoc.json')
        },
        {
            from: path.resolve(templateDir, 'project.json'),
            to: path.resolve(rootDir, 'config', 'project.json')
        }
    ];

    /*
        copy the current node_modules folder to the project directory.
        this will speed up the app install process.
        make sure all required modules are also in this app (package.json)
    */
    var copyDir = [{
        from: path.resolve(__dirname, 'node_modules'),
        to: path.resolve(rootDir, 'node_modules')
    }];


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
            return copy(copyDir.from, copyDir.to).catch((e) => {
                console.log("Folder copy failed. Will slow down the build process but auto fixed with npm install.");
            });
        });
        
    }).then(function () {
        /* 
            copy all config files
        */
        return Promise.each(copyFiles, function (copyFile) {
            console.log("Copy File Fom '%s', to '%s'", copyFile.from, copyFile.to);
            return pfile.copyFileAsync(copyFile.from, copyFile.to);
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
            console.log("\tpackage.json created \n\t\t", path.join(self.config.dir, 'package.json'));
            return pfile.writeFileAsync(path.join(self.config.dir, 'package.json'), JSON.stringify(packageDefinition, null, '\t'));
        });
    });
};

SnProject.prototype.getTestSuites = function () {
    var self = this;
    return self.db.findAsync({ className: 'sys_atf_test_suite' });
};

SnProject.prototype.getTests = function () {
    var self = this;
    return self.db.findAsync({ className: 'sys_atf_test' });
};
SnProject.prototype.getFileById = function (sysId) {
    var self = this;
    return self.db.findOneAsync({ sysId: sysId });
};
SnProject.prototype.deleteFileById = function (sysId) {
    var self = this;
    return self.db.removeAsync({ sysId: sysId });
};
SnProject.prototype.writeFile = function (filePath, content) {  
    var self = this;
    console.log("write to ", path.join(self.config.dir, filePath));
    return pfile.writeFileAsync(path.join(self.config.dir, filePath), content);
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
    return ObjectAssignDeep({
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
    
    return (self.config.includeUnknownEntities || self.config.entities[className]);
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
    if (!entity) // in case there is no such known entity
        return requestArguments;

    // if already processed, take form cache
    if (entity.requestArguments) {
        return entity.requestArguments;    
    }
    
    var fieldNames = [],
        dv = false,
        elementValues = defaultFields.concat([entity.key, entity.subDirPattern]).concat(Object.keys(entity.fields)),
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


    entity.requestArguments = ObjectAssignDeep({}, requestArguments, {
        className: entity.className,
        fieldNames: fieldNames,
        displayValue: dv,
        queryFieldNames: queryFieldNames
    });

    // update the entity in the cache
    _setEntity.call(self, entity);

    return entity.requestArguments;

};

SnProject.prototype.remove = function (removedSysId) {
    var self = this;
    // find all existing which are marked to be deleted
    //console.log("Removing", removedSysId);
    return self.db.findAsync({
        sysId: { $in: removedSysId }
    }).then(function (records) {
        //console.log('DELETE records', records);

        var filesOnDisk = [];

        return Promise.each(records, function (record) {
            var fieldFileOsPath = path.join.apply(null, [self.config.dir].concat(record._id));
            //console.log('DELETE %s', fieldFileOsPath);

            return pfile.deleteFileAsync(fieldFileOsPath).then(function (deleted) {
                if (deleted) {
                    console.log('file successfully deleted %s', fieldFileOsPath);
                    return self.db.removeAsync({
                        sysId: record.sysId
                    }).then(function () {
                        filesOnDisk.push(fieldFileOsPath);
                    });
                }
                return null;
            }).then(function () {
                return pfile.deleteEmptyDirAsync(fieldFileOsPath);
            });
        }).then(function () {
            return filesOnDisk;
        });
    });
};

SnProject.prototype.removeMissing = function (allSysIds, callback) {
    var self = this;
    return self.db.findAsync({
        sysId: { $nin: allSysIds }
    }).then(function (records) {

        var filesOnDisk = [];

        //console.log("Files in DB but not in the response: ", records);
        return Promise.each(records, function (record) {
            var fieldFileOsPath = path.join.apply(null, [self.config.dir].concat(record._id));
            //console.log('DELETE %s', fieldFileOsPath); 
            /*
                https://stackoverflow.com/questions/37521893/determine-if-a-path-is-subdirectory-of-another-in-node-js
            */
            return Promise.try(function () {
                if (callback) {
                    return callback(fieldFileOsPath);
                } else {
                    return pfile.deleteFileAsync(fieldFileOsPath);
                }    
            }).then(function (deleted) {
                if (deleted) {
                    return self.db.removeAsync({
                        sysId: record.sysId
                    }).then(function () {
                        filesOnDisk.push(fieldFileOsPath);
                    });
                }
                return null;
            }).then(function () {
                return pfile.deleteEmptyDirAsync(fieldFileOsPath);
            });
        }).then(function () {
            return filesOnDisk;
        });
        
    });
};

SnProject.prototype.save = function (file) {
    var self = this;
    var promiseFor = Promise.method(function (condition, action, value) {
        if (!condition(value))
            return value;
        return action(value).then(promiseFor.bind(null, condition, action));
    });


    //console.log("save file", file.sys_id);

    var applicationName = file.____.appName;
    var scopeName = file.____.scopeName; 
    var className = file.____.className;

    var fileUUID = ['sn', applicationName];

    var filesOnDisk = [];

    return Promise.try(function () {

        /* the name of the object must be part of the folder
            eg. IBM Watson/Global/UI Page/<name>/
                - client_script.js
                - html.xhtml
        
            if there is a subDirValue the folder structure shall be
            IBM Watson/Global/Business Rule/cmdb_ci/active_true/after/<name>
            <virtualApp>/<AppName>/<entitiyName> [subDirValue] 

        */
        
        var fileObjectArray = [],
            jsDoc;

        var entity = self.getEntity(className);
        if (entity) {
            var entityFullName = entity.name;
            var sysId = file.sys_id.value || file.sys_id;

            fileUUID.push.apply(fileUUID, [entityFullName]);

            jsDoc = {
                file: path.join.apply(null, [self.config.dir].concat(fileUUID, className.concat('.jsdoc'))),
                body: `/**\n * ${applicationName} ${entityFullName}\n * @module ${className}\n * @memberof ${scopeName}\n */\n`
            };

            var keyValue = _substituteField.call(self, entity.key, file) || '{undefined name}';
            var subFolder = (entity.subDirPattern) ? _substituteField.call(self, entity.subDirPattern, file).replace(/^\/|\/$/g, '') : null;
            if (subFolder) {
                // append the subFolder structure to the path
                fileUUID.push.apply(fileUUID, subFolder.split(/\/|\\/));
            }

            var fields = entity.fields || {},
                fieldKeys = Object.keys(fields);

            if (fieldKeys.length > 1) {
                // value part of the path
                fileUUID.push.apply(fileUUID, [keyValue]);
            }

            fieldKeys.forEach(function (fieldName) {

                var extension = fields[fieldName];
                var value = (typeof file[fieldName] == 'object' && file[fieldName] !== null) ? file[fieldName].value : file[fieldName];

                // only create a file if the field has value
                if (value && value.length) {
                    
                    var currentFileUUID = fileUUID.concat([((fieldKeys.length > 1) ? fieldName : keyValue).concat(extension)]); // value part of the file
                    // sanitize all path segments
                    currentFileUUID = currentFileUUID.map(function (val) {
                        return sanitize(val);
                    });

                    var comments = [];
                    comments.push('Application : '.concat(applicationName));
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
                        comments.push('URL         : - '.concat('/').concat(className).concat('.do?sys_id=').concat(sysId));    
                    
                    if (extension == '.js') {
                        value = '/* \n * '.concat(comments.join('\n * ')).concat('\n */\n').concat(value);
                    } else if (/html$/.test(extension)) {
                        value = '<!-- \n * '.concat(comments.join('\n * ')).concat('\n-->\n').concat(value);
                    }

                    fileObjectArray.push({
                        sysId: sysId,
                        fileUUID: currentFileUUID,
                        body: value,
                        hash: crypto.createHash('md5').update(value).digest('hex'),
                        comments: comments,
                        jsDoc: jsDoc,
                        updatedBy: file.____.updatedBy
                    });
                }
                  
            });

        }
        
        if ((!entity && self.config.includeUnknownEntities) || entity.json) {

            // save unknown entity as json on disk
            var extension = '.json';
            var fileName = file.sys_id.value || file.sys_id;

            fileUUID.push.apply(fileUUID, ['_', className, fileName.concat(extension)]);

            // sanitize all path segments
            fileUUID = fileUUID.map(function (val) {
                return sanitize(val);
            });
            try {
                fileObjectArray.push({
                    sysId: file.sys_id.value || file.sys_id,
                    fileUUID: fileUUID,
                    body: JSON.stringify(file, null, 2),
                    hash: crypto.createHash('md5').update((file.sys_updated_on.value || file.sys_updated_on || file.sys_created_on.value || file.sys_created_on)).digest('hex'),
                    comments: null,
                    jsDoc: null,
                    updatedBy: file.____.updatedBy
                });
            } catch (e) {
                console.log(file);
                throw e;
            }    
        }

        return fileObjectArray;

    }).then(function (fileObjectArray) {
       
        /*
        console.log('\t',fileObjectArray.map(function (a) {
            return a.sysId;
        }));
        */
        return Promise.each(fileObjectArray, function (fileObject) {
            
            var cacheKey = path.join.apply(null, fileObject.fileUUID),
                last = fileObject.fileUUID.length - 1,    
                fileName = fileObject.fileUUID[last],
                counter = 0;
            
            return new Promise.try(function () {
                /*
                    create jsDoc file
                */
                var jsDoc = fileObject.jsDoc;
                if (!jsDoc || !jsDoc.file)
                    return;

                return pfile.exists(jsDoc.file).then(function (exists) {
                    if (exists)
                        return;

                    return pfile.writeFileAsync(jsDoc.file, jsDoc.body);
                });

            }).then(function () {
                /* 
                    ensure the file-name is unique
                */
                return promiseFor(function (next) {
                    return (next);
                }, function () {
                    return self.db.findOneAsync({
                        _id: cacheKey,
                        sysId: { $ne: fileObject.sysId }
                    }).then(function (doc) {
                        if (doc) {
                            counter++;
                            //console.warn("there is already an object with the same name but different sys_id! Renaming current file");
                            fileObject.fileUUID[last] = fileName.replace(/(\.[^\.]+)$/, "_" + counter + "$1");
                            cacheKey = path.join.apply(null, fileObject.fileUUID);
                            //console.warn("\tto:", cacheKey);
                            return (counter < 500);
                        }
                        return false;
                    });
                }, true);
                
            }).then(function () {
                /* 
                    find the current cached record
                */
                return self.db.findOneAsync({
                    _id: cacheKey
                });

            }).then(function (entityCache) {
                /*
                    write the file on disk
                */
                var fieldFileOsPath = path.join.apply(null, [self.config.dir].concat(fileObject.fileUUID));
                return pfile.exists(fieldFileOsPath).then(function (exists) {

                    if (exists && entityCache && entityCache.hash == fileObject.hash) {
                        // the file has not changed, return here
                        console.log("\t\tfile has not changed, skip '%s'", fieldFileOsPath);
                        return;
                    }

                    return pfile.writeFileAsync(fieldFileOsPath, fileObject.body).then(function () {
                        console.log("\t\tadd file '%s'", fieldFileOsPath);
                        return self.db.updateAsync({ _id: cacheKey },
                            { _id: cacheKey, counter: counter, hash: fileObject.hash, sysId: fileObject.sysId, className: className, appName: applicationName },
                            { upsert: true });
                    });
                    
                }).then(function () {
                    filesOnDisk.push({
                        path: fieldFileOsPath, updatedBy: fileObject.updatedBy
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
                _setEntity.call(self, ObjectAssignDeep({}, entity, { className: aliasClassName, name: entity.name.concat(':').concat(aliasClassName), alias: null, copyOfClassName: entity.className }));
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
            return (typeof payloadValue == 'object') ? payloadValue.value : payloadValue; //((displayValue) ? payloadValue.display_value : payloadValue.value) : payloadValue; // ((displayValue) ? payloadValue.display_value : payloadValue.value) : payloadValue;
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
            var replaced = key.split('|').some(function (alternative) {

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
                    if (payloadValue) {

                        // take the value automatically form result object or string
                        var value = (typeof payloadValue == 'object') ? ((displayValue) ? payloadValue.display_value : payloadValue.value) : payloadValue;
                        if (value && value.length > 0) {
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

var _copyFile = function (sourceFile, targetFile) {
    return pfile.copyFileAsync(sourceFile, targetFile);
};
module.exports = SnProject;