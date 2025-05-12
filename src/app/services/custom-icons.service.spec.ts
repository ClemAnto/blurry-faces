import { TestBed } from '@angular/core/testing';

import { CustomIconsService } from './custom-icons.service';

describe('CustomIconsService', () => {
  let service: CustomIconsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CustomIconsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
