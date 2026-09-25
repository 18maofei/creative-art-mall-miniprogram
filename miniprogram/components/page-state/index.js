Component({
  properties: { loading: Boolean, error: String, empty: Boolean, emptyText: { type: String, value: '暂时还没有内容' } },
  methods: { retry() { this.triggerEvent('retry') } }
})
