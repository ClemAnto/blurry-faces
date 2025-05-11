import { TestBed } from '@angular/core/testing';

import { VideoProcessingService } from './video-processing.service';

describe('VideoProcessingService', () => {
  let service: VideoProcessingService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VideoProcessingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
