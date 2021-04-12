'use strict'

// Manage args + kwargs
function wdParse (data) {
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
      let tmp = JSON.parse(data.payload)
      if (tmp instanceof Array) {
        args = tmp
        kwargs = undefined
      } else {
        args = []
        kwargs = tmp
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

function wdCompose (args, kwargs) {
  return (!kwargs && args instanceof Array && args.length === 0)
    ? null
    : { args, kwargs }
}

exports.wdParse = wdParse
exports.wdCompose = wdCompose
