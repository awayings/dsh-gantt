// The single React element factory helper shared by every browser module.
//
// The factory stays loosely typed (`any`): the components are plain JavaScript
// and the browser artifact is not type-checked by DSH at runtime, while the
// repo's checkJs pass still validates the rest of each module.
import React from 'react'

/** React element factory. @type {any} */
export const h = React.createElement
