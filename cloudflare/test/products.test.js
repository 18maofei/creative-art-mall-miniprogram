import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeProduct } from '../src/core.js'

test('serializes ordered product detail images and ignores invalid payloads', () => {
  const product = serializeProduct({
    id: 7,
    name: '手工材料包',
    detail_images_json: '["/api/assets/product-covers/first.jpg", "", 3, "/api/assets/product-covers/second.jpg"]'
  })

  assert.deepEqual(product.detail_images, [
    '/api/assets/product-covers/first.jpg',
    '/api/assets/product-covers/second.jpg'
  ])
  assert.deepEqual(serializeProduct({ id: 8, name: '空详情' }).detail_images, [])
  assert.deepEqual(serializeProduct({ id: 9, name: '错误数据', detail_images_json: '{bad json' }).detail_images, [])
})
