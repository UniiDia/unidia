export const templates = [
  { title: '주문 상태', type: '상태', code: `stateDiagram-v2
  [*] --> 접수
  접수 --> 결제완료
  결제완료 --> 배송중
  배송중 --> 배송완료
  배송완료 --> [*]` },
  { title: '월별 방문자', type: 'XY 차트', code: `xychart-beta
  title "월별 방문자"
  x-axis ["3월", "4월", "5월", "6월"]
  y-axis "방문자" 0 --> 100
  bar [35, 52, 68, 84]
  line [35, 52, 68, 84]` },
  { title: '주간 시간 배분', type: '원형 차트', code: `pie showData
  title 주간 시간 배분
  "개발" : 50
  "테스트" : 30
  "설계" : 20` },
  { title: '프로젝트 구상', type: '마인드맵', code: `mindmap
  root((팀 프로젝트))
    기획
      사용자 인터뷰
      기능 정의
    개발
      화면 구현
      테스트` },
  { title: '팀 작업 보드', type: '칸반', code: `kanban
  todo[할 일]
    design[화면 설계]
  doing[진행 중]
    api[데이터 연결]
  done[완료]
    plan[일정 정리]` },
  { title: '저장 기능 검증', type: '요구사항', code: `requirementDiagram
  requirement SaveDiagram {
    id: 1
    text: Save diagram as JSON
    risk: low
    verifymethod: test
  }
  element SaveTest {
    type: "test case"
  }
  SaveTest - verifies -> SaveDiagram` },
  { title: '예산 흐름', type: 'Sankey', code: `sankey-beta

Budget,Development,60
Budget,Design,40
Development,Tools,20
Development,People,40
Design,People,40` },
  { title: '역량 비교', type: '레이더 차트', code: `radar-beta
  axis coding["개발"], design["설계"], testing["검증"]
  curve teamA["A팀"]{4, 3, 5}
  curve teamB["B팀"]{3, 5, 4}
  max 5` },
];
