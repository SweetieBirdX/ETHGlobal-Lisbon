export interface DataProvider {
  getCohortInsight(criteria: object): Promise<object>;
}

export class MockDataProvider implements DataProvider {
  async getCohortInsight(_criteria: object): Promise<object> {
    const trend = Math.random() > 0.5 ? 'up' : 'flat';

    return {
      participantCount: 42,
      avgPerformanceScore: 87.4,
      trend,
    };
  }
}
