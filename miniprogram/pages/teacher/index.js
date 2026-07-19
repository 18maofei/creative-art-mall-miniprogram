const { mockState } = require('../../services/api')
Page({
  data: { students: mockState.students, locked: false },
  toggle(e) { if (this.data.locked) return; const { index, state } = e.currentTarget.dataset; const students = this.data.students.map((s, i) => i === Number(index) ? { ...s, state } : s); this.setData({ students }) },
  confirm() { const attended = this.data.students.filter(s => s.state === '出勤').length; this.setData({ locked: true }); wx.showModal({ title: '考勤已确认', content: `${attended} 位出勤学员已扣减 1 次课时；请假学员未扣课。`, showCancel: false }) }
})
