const { courses } = require('../../services/api')
Page({
  data: { allCourses: [], courses: [], selected: 'ALL' },
  onLoad() { courses().then(rows => { const list = rows.map((item, index) => item.default_lesson_count ? ({ id:item.id,name:item.name,age:item.age_range,lessons:item.default_lesson_count,schedule:'请向画室咨询排课',price:Number(item.price),description:item.description,category:index ? 'ADVANCED' : 'INTRO' }) : item); this.setData({ allCourses:list, courses:list }) }) },
  filter(e) { const selected=e.currentTarget.dataset.type; this.setData({ selected, courses:selected==='ALL'?this.data.allCourses:this.data.allCourses.filter(item=>item.category===selected) }) },
  open(e) { wx.navigateTo({ url: `/pages/course-detail/index?id=${e.currentTarget.dataset.id}` }) }
})
