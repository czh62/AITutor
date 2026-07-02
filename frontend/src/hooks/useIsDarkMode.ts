/**
 * 当前是否为暗色模式。
 *
 * 主题切换已移除（界面固定浅色），恒返回 false。
 * 保留 hook 供 GraphViewer / GraphControl 的图谱配色逻辑调用，
 * 无需改动这些组件即可让它们走浅色配色分支。
 */
const useIsDarkMode = (): boolean => false

export default useIsDarkMode
