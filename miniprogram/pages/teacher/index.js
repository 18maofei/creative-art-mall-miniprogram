const { mockState, devContext, teacherSessions, attendance, confirmAttendance } = require('../../services/api')
Page({
  data: { students: mockState.students, locked: false, sessionId: 1, teacherUserId: null },
  onLoad() {
    devContext().then(context => teacherSessions(context).then(sessions => ({ context, sessions }))).then(({ context, sessions }) => {
      const sessionId = sessions[0]?.id
      if (!sessionId) throw new Error('暂无课程')
      return attendance(sessionId).then(rows => ({ context, sessionId, rows }))
    }).then(({ context, sessionId, rows }) => {
      const students = rows.map(item => item.child_id ? ({ id: item.child_id, name: item.name, initial: item.name.slice(0, 1), state: item.status === 'PRESENT' ? '出勤' : item.status === 'LEAVE' ? '请假' : '缺勤', remaining: Number(item.remaining_lessons) }) : item)
      this.setData({ students, sessionId, teacherUserId: context.teacherUserId })
    }).catch(() => wx.showToast({ title: '考勤加载失败', icon: 'none' }))
  },
  toggle(e) { if (this.data.locked) return; const { index, state } = e.currentTarget.dataset; const students = this.data.students.map((s, i) => i === Number(index) ? { ...s, state } : s); this.setData({ students }) },
  confirm() {
    const records = this.data.students.map(s => ({ childId: s.id, status: s.state === '出勤' ? 'PRESENT' : s.state === '请假' ? 'LEAVE' : 'ABSENT' }))
    confirmAttendance(this.data.sessionId, this.data.teacherUserId, records).then(result => {
      this.setData({ locked: true })
      wx.showModal({ title: '考勤已确认', content: `${result.records.length} 位出勤学员已扣减 1 次课时；请假学员未扣课。`, showCancel: false })
    }).catch(() => wx.showToast({ title: '确认失败，请稍后重试', icon: 'none' }))
  }
})
