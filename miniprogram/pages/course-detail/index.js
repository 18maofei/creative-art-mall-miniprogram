const { courses } = require('../../services/api')
Page({ data:{ course:null }, onLoad(q){ courses().then(rows=>{ const item=rows.find(row=>String(row.id)===String(q.id)); this.setData({course:item}) }) }, apply(){ wx.showModal({title:'报名申请',content:'已提交课程咨询申请，画室会联系您确认班级和排课。',showCancel:false}) } })
