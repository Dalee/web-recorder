declare module 'worker-loader!*' {
  class WebpackWorker extends Worker {
    constructor()
  }

  export = WebpackWorker
}

declare function require(name: string): any
