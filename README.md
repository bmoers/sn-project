# Project module for CICD Server for Service-Now

Export files (records extending sys_metadata) from Service-Now to a nodejs like project on disk.  
Inspired by [jmbauguess/ServiceNowScriptDocumenter](https://github.com/jmbauguess/ServiceNowScriptDocumenter)

## Configuration

Add the table-name (ClassName) to `config/entities.json` in following format:

```js
{
"sys_variable_value": { // table-name
        "name": "Values",   // display name (used for folder name)
        "key": "<document_key!dv>", // the file name
        "alias": ["sysauto_script", "wf_workflow_schedule"], // extending tables with the same rule
        "json": true, // export file as json
        "query": "variable.internal_type=script^ORvariable.internal_type=script_plain^ORvariable.internal_type=script_server", // filter on the objects
        "fields": {
            "value": ".js" // fields to be exported
        },
        "subDirPattern": "<document>" // additional sub-directory
    }
}
```

## Variables in entities.json

```
    take first not null value
        <cat_item|variable_set>

    displayValue of the field
        <cat_item!dv>

    optional displayValue of the field
        <cat_item!dv?>

    optional field
        <cat_variable?>

    default 'global' if empty
        <table|'global'>
```

## nodejs templates
By default files from ./default-templates are copied into target nodejs project. If you require a different gulp plan, point to custom files by passing a templateDir on init of the module.

- atf-wrapper.js : Mocha wrapper to call ATF tests in Service-Now
- jsdoc.json : Standards used in JSDoc generation
- project.json : Example config file used in gulp
- gulpfile.js : the gulp 'build plan'

## DB
Changes are tracked via MD5 hash of file and saved to embedded [nedb](https://github.com/louischatriot/nedb). Files on disk are **only** updated if relevant fields have changed.