'use strict';

// Manage args + kwargs
module.exports = function(data) {
    let args, kwargs;
    if (data.args !== undefined) {
        args = data.args;
        kwargs = data.kwargs;
    }
    else if (data.payload !== undefined) {
        let payload = JSON.parse(data.payload);
        if (data instanceof Array) {
            args = payload;
            kwargs = {};
        }
        else {
            args = [];
            kwargs = payload;
        }
    }
    else {
        args = []; // args
        kwargs = data.kv;
    }
    return [args, kwargs];
}
