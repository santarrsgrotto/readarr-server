export type Store = {
  [key: string]: any
}

class StoreManager {
  private store: Store = {}

  get<T>(key: keyof Store): T | undefined {
    return this.store[key] as T
  }

  set<T>(key: keyof Store, value: T): void {
    this.store[key] = value
  }

  unset<tr>(key: keyof Store): void {
    delete this.store[key]
  }
}

const store = new StoreManager()

export default store
