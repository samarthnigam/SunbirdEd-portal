import { CertConfigModel } from './../../models/cert-config-model/cert-config-model';
import { Component, OnInit, OnDestroy, ViewChild, HostListener } from '@angular/core';
import { CertificateService, UserService, PlayerService, CertRegService } from '@sunbird/core';
import * as _ from 'lodash-es';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { ResourceService, NavigationHelperService, ToasterService } from '@sunbird/shared';
import { Router, ActivatedRoute } from '@angular/router';
import { combineLatest, of, Subject } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { TelemetryService, IImpressionEventInput } from '@sunbird/telemetry'

export enum ProcessingModes {
  PROCESS_DROPDOWNS = 'processDropdowns',
  PROCESS_CRITERIA = 'processCriteria'
}

export interface IConfigLabels {
  label: string;
  name: string;
  show: boolean;
}

@Component({
  selector: 'app-certificate-configuration',
  templateUrl: './certificate-configuration.component.html',
  styleUrls: ['./certificate-configuration.component.scss']
})
export class CertificateConfigurationComponent implements OnInit, OnDestroy {
  @ViewChild('selectCertType') selectCertType;
  @ViewChild('selectRecipient') selectRecipient;
  @ViewChild('templateChangeModal') templateChangeModal;

  public unsubscribe$ = new Subject<void>();
  showanotherscreen: boolean;
  showErrorModal;
  showPreviewModal;
  showTemplateDetectModal;

  certTypes: any;
  issueTo: any;

  telemetryImpression: IImpressionEventInput;
  userPreference: FormGroup;
  disableAddCertificate = true;
  queryParams: any;
  courseDetails: any;
  showLoader = true;
  certTemplateList: Array<{}>;
  batchDetails: any;
  currentState: any;
  screenStates: any = {'default': 'default', 'certRules': 'certRules' };
  selectedTemplate: any;
  previewTemplate: any;
  configurationMode: string;
  certConfigModalInstance = new CertConfigModel();
  previewUrl: string;
  templateIdentifier: string;
  isTemplateChanged = false;
  certEditable = true;
  config: {select: IConfigLabels, preview: IConfigLabels, remove: IConfigLabels};


  constructor(
    private certificateService: CertificateService,
    private userService: UserService,
    private playerService: PlayerService,
    private resourceService: ResourceService,
    private certRegService: CertRegService,
    public navigationHelperService: NavigationHelperService,
    private activatedRoute: ActivatedRoute,
    private toasterService: ToasterService,
    private router: Router,
    private telemetryService: TelemetryService ) { }

  @HostListener('window:popstate', ['$event'])
  onPopState(event) {
    if (this.isTemplateChanged) {
      this.isTemplateChanged = false;
    }
  }

  ngOnInit() {
    this.initializeLabels();
    this.currentState = this.screenStates.default;
    this.navigationHelperService.setNavigationUrl();
    this.initializeFormFields();
    this.activatedRoute.queryParams.subscribe((params) => {
      this.queryParams = params;
      this.configurationMode = _.get(this.queryParams, 'type');
    });
    combineLatest(
    this.getCourseDetails(_.get(this.queryParams, 'courseId')),
    this.getBatchDetails(_.get(this.queryParams, 'batchId')),
    this.getTemplateList(),
    ).subscribe((data) => {
      this.showLoader = false;
      const [courseDetails, batchDetails, config] = data;
    }, (error) => {
      this.showLoader = false;
      this.toasterService.error(this.resourceService.messages.emsg.m0005);
    });
  }

  ngAfterViewInit() {
    this.setTelemetryImpressionData();
  }

  initializeLabels() {
    this.config = {
      select: {
        label: this.resourceService.frmelmnts.lbl.Select,
        name: 'Select',
        show: true
    },
    preview: {
        label: this.resourceService.frmelmnts.cert.lbl.preview,
        name: 'Preview',
        show: true
    },
    remove: {
        label: this.resourceService.frmelmnts.cert.lbl.unselect,
        name: 'Remove',
        show: false
    }
  };
  }

  getCertConfigFields() {
    const request = {
      request: {
        orgId: this.userService.slug,
        key: 'certRules'
      }
    };
    this.certificateService.fetchCertificatePreferences(request).subscribe(certRulesData => {
      const dropDownValues = this.certConfigModalInstance.getDropDownValues(_.get(certRulesData, 'result.response.data.fields'));
      this.certTypes = _.get(dropDownValues, 'certTypes');
      this.issueTo = _.get(dropDownValues, 'issueTo');
    }, error => {
      this.toasterService.error(this.resourceService.messages.emsg.m0005);
    });
  }

  getTemplateList() {
    const request = {
      request: {
        orgId: this.userService.slug,
        key: 'certList'
      }
    };
    return this.certificateService.fetchCertificatePreferences(request).pipe(
      tap((certTemplateData) => {
        this.certTemplateList = _.get(certTemplateData, 'result.response.data.range');
      }),
      catchError(error => {
        return of({});
      })
    );
  }

  getBatchDetails(batchId) {
    return this.certificateService.getBatchDetails(batchId).pipe(
      tap(batchDetails => {
        this.batchDetails = _.get(batchDetails, 'result.response');
        if (!_.get(this.batchDetails, 'cert_templates')) {
          this.getCertConfigFields();
        } else {
          this.processCertificateDetails(_.get(this.batchDetails, 'cert_templates'));
        }
      })
    );
  }

  initializeFormFields() {
    this.userPreference = new FormGroup({
      certificateType: new FormControl('', [Validators.required]),
      issueTo: new FormControl('', [Validators.required]),
      allowPermission: new FormControl('', [Validators.required])
    });
    this.userPreference.valueChanges.subscribe(val => {
        this.validateForm();
    });
  }

  validateForm() {
    if (this.userPreference.status === 'VALID'
    && _.get(this.userPreference, 'value.allowPermission') && !_.isEmpty(this.selectedTemplate)) {
      this.disableAddCertificate = false;
    } else {
      this.disableAddCertificate = true;
    }
  }

  getCourseDetails(courseId: string) {
    return this.playerService.getCollectionHierarchy(courseId).pipe(
      tap(courseData => {
        this.courseDetails = _.get(courseData, 'result.content');
      }, catchError(error => {
        return of({});
      }))
    );
  }

  updateCertificate() {
    if (this.templateIdentifier !== _.get(this.selectedTemplate, 'name')) {
      this.isTemplateChanged = true;
    } else {
      this.attachCertificateToBatch();
    }
  }

  attachCertificateToBatch() {
    this.sendInteractData({id: this.configurationMode === 'add' ? 'attach-certificate' : 'confirm-template-change'});
    const request = {
      request: {
        courseId: _.get(this.queryParams, 'courseId'),
        batchId: _.get(this.queryParams, 'batchId'),
        key: _.get(this.selectedTemplate, 'name'),
        orgId: _.get(this.userService, 'slug'),
        criteria: this.getCriteria(_.get(this.userPreference, 'value'))
      }
    };
    if (this.isTemplateChanged) {
      request['request']['oldTemplateId'] = this.templateIdentifier;
    }

    this.certRegService.addCertificateTemplate(request).subscribe(data => {
      this.isTemplateChanged = false;
      if (this.configurationMode === 'add') {
        this.toasterService.success(this.resourceService.frmelmnts.cert.lbl.certAddSuccess);
      } else {
        this.toasterService.success(this.resourceService.frmelmnts.cert.lbl.certUpdateSuccess);
      }
      this.certificateService.getBatchDetails(_.get(this.queryParams, 'batchId')).subscribe(batchDetails => {
        this.batchDetails = _.get(batchDetails, 'result.response');
        this.processCertificateDetails(_.get(this.batchDetails, 'cert_templates'));
        this.goBack();
      }, error => {
      });
    }, error => {

      if (this.configurationMode === 'add') {
        this.toasterService.error(this.resourceService.frmelmnts.cert.lbl.certAddError);
      } else {
        this.toasterService.error(this.resourceService.frmelmnts.cert.lbl.certEditError);
      }
    });
  }

  processCertificateDetails(certTemplateDetails) {
    const templateData = _.pick(_.get(certTemplateDetails, Object.keys(certTemplateDetails)), ['criteria', 'identifier', 'previewUrl']);
    this.selectedTemplate = {name : _.get(templateData, 'identifier')};
    this.templateIdentifier =  _.get(templateData, 'identifier');
    this.previewUrl = _.get(templateData, 'previewUrl');
    this.setCertEditable();
    this.processCriteria( _.get(templateData, 'criteria'));
  }

  setCertEditable() {
    this.certEditable = this.previewUrl ? true : false;
  }

  editCertificate() {
    this.configurationMode = 'edit';
    this.currentState = this.screenStates.certRules;
    this.sendInteractData({id: 'edit-certificate'});
  }

  getCriteria(rawDropdownValues) {
   const processedData = this.certConfigModalInstance.processDropDownValues(rawDropdownValues, _.get(this.userService, 'userProfile.rootOrgId'));
   return processedData;
  }

  processCriteria(criteria) {
    const abc = this.certConfigModalInstance.processCriteria(criteria);
    this.issueTo = _.get(abc, 'issueTo');
    this.certTypes = _.get(abc, 'certTypes');
    const certTypeFormEle = this.userPreference.controls['certificateType'];
    const issueToFormEle = this.userPreference.controls['issueTo'];
    this.issueTo && this.issueTo.length > 0 ? issueToFormEle.setValue(this.issueTo[0].name) : issueToFormEle.setValue('');
    this.certTypes && this.certTypes.length > 0 ? certTypeFormEle.setValue(this.certTypes[0].name) : certTypeFormEle.setValue('');
  }

  handleCertificateEvent(event, template: {}) {
    const show = _.get(this.selectedTemplate, 'name') === _.get(template, 'name');
    switch (_.lowerCase(_.get(event, 'name'))) {
      case 'select' :
        this.selectedTemplate = template;
        this.config.remove.show = show;
        this.config.select.show = !show;
        this.validateForm();
        this.sendInteractData({id: 'select-template'});
        break;
      case 'remove' :
        this.selectedTemplate = {};
        this.config.select.show = show;
        this.config.remove.show = !show;
        this.validateForm();
        this.sendInteractData({id: 'unselect-template'});
        break;
      case 'preview':
        this.previewTemplate = template;
        this.showPreviewModal = true;
        this.sendInteractData({id: 'preview-template'});
        break;
    }
  }

  getConfig(config: {show: boolean, label: string, name: string}, template) {
    const show = _.get(this.selectedTemplate, 'name') === _.get(template, 'name');
    if (_.lowerCase(_.get(config, 'label')) === 'select') {
        return ({show: !show, label: config.label, name: config.name});
    } else {
      return ({show: show, label: config.label, name: config.name});
    }
  }

  closeModal(event) {
    this.showPreviewModal = false;
    this.selectedTemplate = _.get(event, 'name') ? _.get(event, 'template') : this.selectedTemplate;
    this.validateForm();
    if (_.get(event, 'name')) {
      this.sendInteractData({id: 'select-template'});
    } else {
      this.sendInteractData({id: 'close-preview'});
    }
  }

  closeTemplateDetectModal () {
    this.isTemplateChanged = false;
    this.sendInteractData({id: 'cancel-template-change' });
  }

  navigateToCertRules() {
    this.currentState = this.screenStates.certRules;
    this.sendInteractData({ id: 'add-certificate' });
  }

  goBack() {
    if (this.currentState === this.screenStates.certRules) {
      // Goback to cert list screen
      this.currentState = this.screenStates.default;
    } else {
      this.navigationHelperService.navigateToLastUrl();
    }
  }

  cancelSelection() {
    this.currentState = this.screenStates.default;
    this.userPreference.controls['allowPermission'].reset();
    this.sendInteractData({id: this.configurationMode === 'add' ? 'cancel-add-certificate' : 'cancel-update-certificate' });
    if (this.configurationMode === 'add') {
      this.userPreference.reset();
      this.selectedTemplate = {};
    } else {
      this.processCertificateDetails(_.get(this.batchDetails, 'cert_templates'));
    }
  }

  setTelemetryImpressionData(navigatedPageId?) {
    this.telemetryImpression = {
      context: {
        env: this.activatedRoute.snapshot.data.telemetry.env,
        cdata: [{
          type: 'Batch',
          id: _.get(this.queryParams, 'batchId')
        },
        {
          type: 'Course',
          id: _.get(this.queryParams, 'courseId')
        }]
      },
      edata: {
        type: this.activatedRoute.snapshot.data.telemetry.type,
        subtype: this.activatedRoute.snapshot.data.telemetry.subtype,
        pageid: navigatedPageId ? navigatedPageId : this.activatedRoute.snapshot.data.telemetry.pageid,
        uri: this.router.url,
        duration: this.navigationHelperService.getPageLoadTime()
      }
    };
    this.telemetryService.impression(this.telemetryImpression);
  }

  sendInteractData(interactData, interactObject?) {
    const data = {
      context: {
        env: this.activatedRoute.snapshot.data.telemetry.env,
        cdata: [{
          type: 'Batch',
          id: _.get(this.queryParams, 'batchId')
        },
        {
          type: 'Course',
          id: _.get(this.queryParams, 'courseId')
        }]
      },
      edata: {
        id: _.get(interactData, 'id'),
        type: 'CLICK',
        pageid: this.activatedRoute.snapshot.data.telemetry.pageid
      }
    };

    if (this.configurationMode === 'edit') {
      data['object'] = {
        id: _.get(this.selectedTemplate, 'name'),
        type: 'Certificate',
        ver: '1.0',
        rollup: { l1: _.get(this.queryParams, 'courseId') }
      };
    }

    this.telemetryService.interact(data);
  }

  ngOnDestroy() {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }
}