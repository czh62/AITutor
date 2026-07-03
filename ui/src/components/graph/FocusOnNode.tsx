import { useCamera, useSigma } from '@react-sigma/core'
import { useEffect } from 'react'
import { useGraphStore } from '@/stores/graph'

/**
 * 高亮选中节点并将相机居中到该节点。
 */
const FocusOnNode = ({ node, move }: { node: string | null; move?: boolean }) => {
  const sigma = useSigma()
  const { gotoNode } = useCamera()

  useEffect(() => {
    const graph = sigma.getGraph();

    if (move) {
      if (node && graph.hasNode(node)) {
        try {
          graph.setNodeAttribute(node, 'highlighted', true);
          gotoNode(node);
        } catch (error) {
          console.error('Error focusing on node:', error);
        }
      } else {
        sigma.setCustomBBox(null);
        sigma.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 0 });
      }
      useGraphStore.getState().setMoveToSelectedNode(false);
    } else if (node && graph.hasNode(node)) {
      try {
        graph.setNodeAttribute(node, 'highlighted', true);
      } catch (error) {
        console.error('Error highlighting node:', error);
      }
    }

    return () => {
      if (node && graph.hasNode(node)) {
        try {
          graph.setNodeAttribute(node, 'highlighted', false);
        } catch (error) {
          console.error('Error cleaning up node highlight:', error);
        }
      }
    }
  }, [node, move, sigma, gotoNode])

  return null
}

export default FocusOnNode
