import api from '../api'

const x = await api.get('/sample/items')
api.post('/sample/items', payload)
const url = `/sample/items/${id}`
api.delete(url)
// api.put('/sample/items/1') — закомменчено, не считаем
api.get(`/sample/items/${itemId}/details`)
