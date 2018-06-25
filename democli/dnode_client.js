var dnode = require('dnode');

dnode.connect(7070, function (remote, conn) {
console.log(remote);
    remote.zing(33, function (n) {
        console.log('n1=' + n);
    });

    remote.zing(77, function (n) {
        console.log('n2=' + n);
    });

    remote.mtr('YA', function (s) {
        console.log('YA=' + s);
        conn.end();
    });

    remote.nx('YA', function (s) {
        console.log('YA=' + s);
        conn.end();
    });
});
