'use strict';

// Manage args + kwargs
module.exports = function(data) {
    let msg = [];
    if (data.args !== undefined) {
        msg.push(data.args);
        msg.push(data.kwargs);
    }
    else if (data.payload !== undefined) {
        let payload = JSON.parse(data.payload);
        if (data instanceof Array) {
            msg.push(payload);
            msg.push({});
        }
        else {
            msg.push([]);
            msg.push(payload);
        }
    }
    else {
        msg.push([]); // args
        msg.push(data.kv);
    }
    return msg;
}
