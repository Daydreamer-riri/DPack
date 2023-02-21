const slash3 = require('slash3')

document.querySelector('#required-slash3-exists').textContent =
  !!slash3('foo/bar')
