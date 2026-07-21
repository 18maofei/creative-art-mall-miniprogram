Page({ data:{ tabs:['课程作品','教学花絮'], selected:0, items:[['孩子的色彩练习','创作中的小小建筑师'],['老师示范构图','课堂材料探索']] }, select(e){this.setData({selected:Number(e.currentTarget.dataset.index)})} })
