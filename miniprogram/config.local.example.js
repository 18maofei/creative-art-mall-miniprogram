/**
 * 本地联调示例：需要联调时将内容复制到 config.js，发布前再恢复为线上配置。
 */
module.exports = {
  apiBaseUrl: 'http://127.0.0.1:3000',
  institutionName: '拾色画室',
  demoMode: true,
  allowInsecureHttp: true,
  paymentMode: 'mock',
  demoOpenids: {
    PARENT: 'demo-parent-001',
    TEACHER: 'demo-teacher-001',
    STUDENT: 'demo-student-001',
    OPERATOR: 'demo-operator-001',
    ADMIN: 'demo-admin-001'
  }
}
