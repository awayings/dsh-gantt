interface Window {
  __ModuleLoader__: {
    load: (module: {
      id: string
      factory: (require: (id: string) => unknown) => unknown
    }) => void
  }
}

declare function require(id: string): any
