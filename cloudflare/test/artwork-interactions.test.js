import test from 'node:test'
import assert from 'node:assert/strict'
import { Router, sessionFor } from '../src/core.js'
import { registerPublicRoutes, serializeArtwork, serializeArtworkComment } from '../src/public-routes.js'

test('serializes artwork interaction counts and viewer like state', () => {
  const artwork = serializeArtwork({
    id: 12,
    title: '春日的树',
    description: '水彩作品',
    image_url: '/api/assets/artworks/tree.jpg',
    likes_count: 4,
    comments_count: 2,
    liked_by_me: 1
  })

  assert.equal(artwork.id, 12)
  assert.equal(artwork.description, '水彩作品')
  assert.equal(artwork.likes_count, 4)
  assert.equal(artwork.comments_count, 2)
  assert.equal(artwork.liked_by_me, true)
  assert.equal(serializeArtwork({ id: 13, liked_by_me: 0 }).liked_by_me, false)
})

test('serializes the author and moderation state for artwork comments', () => {
  assert.deepEqual(serializeArtworkComment({
    id: 21,
    author_name: '林小艺',
    content: '颜色搭配很舒服！',
    status: 'PENDING',
    created_at: '2026-11-01T08:00:00.000Z',
    is_mine: 1
  }), {
    id: 21,
    author_name: '林小艺',
    content: '颜色搭配很舒服！',
    status: 'PENDING',
    created_at: '2026-11-01T08:00:00.000Z',
    is_mine: true
  })
})

function fakeDatabase(deleteChanges) {
  const statements = []
  return {
    statements,
    prepare(sql) {
      const statement = { sql, params: [] }
      statements.push(statement)
      return {
        bind(...params) { statement.params = params; return this },
        async first() {
          if (sql.startsWith('SELECT id, display_name, mobile, email, avatar_url, status')) {
            return { id: 7, display_name: '用户7', status: 'ACTIVE' }
          }
          return null
        },
        async all() {
          if (sql.includes('SELECT role FROM user_roles')) return { results: [{ role: 'PARENT' }] }
          return { results: [] }
        },
        async run() { return { meta: { changes: deleteChanges } } }
      }
    }
  }
}

async function deleteCommentRequest(database) {
  const router = new Router()
  registerPublicRoutes(router)
  const secret = 'artwork-comment-test-session-secret'
  const token = await sessionFor({ id: 7, roles: ['PARENT'], currentRole: 'PARENT' }, secret)
  const request = new Request('https://api.example.test/api/artworks/12/comments/55', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  })
  return router.dispatch(request, { SESSION_SECRET: secret, DB: database })
}

test('deletes an artwork comment only for its author', async () => {
  const database = fakeDatabase(1)
  const response = await deleteCommentRequest(database)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: { id: 55, deleted: true } })
  const deletion = database.statements.find(statement => statement.sql.includes('DELETE FROM artwork_comments'))
  assert.deepEqual(deletion.params, [55, 12, 7])
  assert.match(deletion.sql, /user_id = \?/)
})

test('does not reveal or delete another user\'s artwork comment', async () => {
  const database = fakeDatabase(0)

  await assert.rejects(
    () => deleteCommentRequest(database),
    error => error.status === 404 && error.message === '评论不存在或无权删除'
  )
  const deletion = database.statements.find(statement => statement.sql.includes('DELETE FROM artwork_comments'))
  assert.deepEqual(deletion.params, [55, 12, 7])
})
