'use strict'

// Manage args + kwargs
module.exports = function (data) {
  let args, kwargs
  if (data === null) {
    args = []
    kwargs = undefined
  } else
  if (data.args !== undefined) {
    args = data.args
    kwargs = data.kwargs
  }
  else if (data.payload !== undefined) {
    try {
      if (data instanceof Array) {
        args = JSON.parse(data.payload)
        kwargs = undefined
      } else {
        args = []
        kwargs = JSON.parse(data.payload)
      }
    } catch (err) {
      args = [data.payload.toString()]
      kwargs = undefined
    }
  }
  else {
    args = []
    kwargs = data.kv
  }
  return [args, kwargs]
}
