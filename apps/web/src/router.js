import CreationView from './views/CreationView.vue'
import AvatarTrainView from './views/AvatarTrainView.vue'
import MatrixAccountsView from './views/MatrixAccountsView.vue'

export default [
  {
    path: '/',
    name: 'creation',
    component: CreationView
  },
  {
    path: '/avatar-train',
    name: 'avatar-train',
    component: AvatarTrainView
  },
  {
    path: '/matrix-accounts',
    name: 'matrix-accounts',
    component: MatrixAccountsView
  }
]
