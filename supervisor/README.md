# demo easy start

## resource-lock.supervisord.ini
three clients that lock resource for the 5 second each, so the next able to lock the resource after the previous release it

- to start:
```shell
$ supervisord -c ./resource-lock.supervisord.ini
```

## leaderless.supervisord.ini
leaderless queue work

- to start:
```shell
$ supervisord -c ./leaderless.supervisord.ini


```
