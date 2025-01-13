import { getHeapStatistics } from 'v8'

const stats = getHeapStatistics()
const heapLimitGB = (stats.heap_size_limit / 1024 / 1024 / 1024).toFixed(2)
console.log(`Heap size limit: ${stats.heap_size_limit} :: ${heapLimitGB} GB`)
