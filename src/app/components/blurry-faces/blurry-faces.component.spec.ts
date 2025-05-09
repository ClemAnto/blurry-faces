import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { BlurryFacesComponent } from './blurry-faces.component';

describe('BlurryFacesComponent', () => {
  let component: BlurryFacesComponent;
  let fixture: ComponentFixture<BlurryFacesComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [BlurryFacesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BlurryFacesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
