import {
  Component,
  ChangeDetectorRef,
  ElementRef,
  ViewChild,
  inject,
  type OnDestroy
} from '@angular/core';

import { ActivatedRoute } from '@angular/router';

import {
  AlertController,
  IonContent,
  IonIcon,
  type ViewWillEnter
} from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  cafeOutline,
  checkmarkCircleOutline,
  chevronBackOutline,
  chevronForwardOutline,
  downloadOutline,
  timeOutline
} from 'ionicons/icons';

import { Capacitor } from '@capacitor/core';

import {
  Directory,
  Filesystem
} from '@capacitor/filesystem';

import { Share } from '@capacitor/share';

import * as pdfjsLib from 'pdfjs-dist';

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

import type {
  TDocumentDefinitions,
  TableCell
} from 'pdfmake/interfaces';

import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';

/* =========================================
   PDF CONFIGURATION
   ========================================= */

// Keep the working PDFMake font configuration.
pdfMake.addVirtualFileSystem(
  pdfFonts as unknown as Record<string, string>
);

// PDF.js worker for browser and Android WebView.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'assets/pdf.worker.min.mjs';

/* =========================================
   INTERFACES
   ========================================= */

interface CalendarDay {
  date: Date;
  key: string;
  number: number;
  label: string;
  fullLabel: string;
}

type DtrStatus =
  | 'verified'
  | 'provisional'
  | 'rejected';

interface DtrRecord {
  date: string;
  timeIn: string;
  timeOut: string;
  status: DtrStatus;
  minutes: number;
}

/* =========================================
   DTR PAGE
   ========================================= */

@Component({
  selector: 'app-dtr',
  standalone: true,
  imports: [
    IonContent,
    IonIcon
  ],
  templateUrl: './dtr.page.html',
  styleUrls: ['./dtr.page.scss']
})
export class DtrPage implements ViewWillEnter, OnDestroy {

  /* =========================================
     SERVICES
     ========================================= */

  private readonly route = inject(ActivatedRoute);

  private readonly alertController =
    inject(AlertController);

  private readonly supabaseService =
    inject(SupabaseService);

  private readonly authService =
    inject(AuthService);

  private readonly cdRef =
    inject(ChangeDetectorRef);

  private readonly supabase =
    this.supabaseService.getClient();

  private destroyed = false;

  /* =========================================
     STUDENT INFORMATION
     ========================================= */

  studentId = '';
  studentFullName = '';
  studentCompany = '';

  /* =========================================
     CALENDAR SETTINGS
     ========================================= */

  calendarMode: 'weekly' | 'monthly' = 'weekly';

  selectedDate: Date = new Date();

  weekdays = [
    'SUN',
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT'
  ];

  /* =========================================
     OJT HOURS
     ========================================= */

  requiredHours = 486;

  verifiedHours = 0;
  provisionalHours = 0;

  records: DtrRecord[] = [];

  /* =========================================
     PDF PREVIEW
     ========================================= */

  isGeneratingPdf = false;
  isPdfPreviewOpen = false;

  // Retained for compatibility with existing HTML.
  // The new preview uses PDF.js, not an iframe.
  pdfPreviewUrl: string | null = null;

  @ViewChild('pdfPagesContainer')
  pdfPagesContainer?: ElementRef<HTMLDivElement>;

  private pdfRenderVersion = 0;

  /* =========================================
     CONSTRUCTOR
     ========================================= */

  constructor() {
    addIcons({
      chevronBackOutline,
      chevronForwardOutline,
      cafeOutline,
      checkmarkCircleOutline,
      timeOutline,
      downloadOutline
    });
  }

  /* =========================================
     LIFECYCLE
     ========================================= */

  ngOnDestroy(): void {
    this.destroyed = true;
    this.closePdfPreview();
  }

  private refresh(): void {
    if (!this.destroyed) {
      this.cdRef.detectChanges();
    }
  }

  async ionViewWillEnter(): Promise<void> {

    const id =
      this.route.snapshot.queryParamMap.get('studentId') ||
      this.authService.getStudentId() ||
      localStorage.getItem('studentId');

    if (!id) {
      console.error(
        'DTR: No student ID found.'
      );

      this.studentId = '';
      this.studentFullName = '';
      this.studentCompany = '';

      this.records = [];
      this.verifiedHours = 0;
      this.provisionalHours = 0;

      this.refresh();
      return;
    }

    this.studentId = id;

    const results = await Promise.allSettled([
      this.loadStudentProfile(),
      this.loadAttendanceFromSupabase()
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(
          'DTR: Data loading failed:',
          result.reason
        );
      }
    }

    this.refresh();
  }

  /* =========================================
     STUDENT PROFILE
     ========================================= */

  private async loadStudentProfile(): Promise<void> {

    this.studentFullName = '';
    this.studentCompany = '';

    const { data, error } = await this.supabase
      .from('students')
      .select('*')
      .eq('student_id', this.studentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return;
    }

    this.studentFullName =
      data.full_name ||
      data.name ||
      '';

    this.studentCompany =
      data.company_location ||
      data.company_name ||
      '';
  }

  /* =========================================
     DATE HELPERS
     ========================================= */

  private dateKey(date: Date): string {

    const year = date.getFullYear();

    const month = String(
      date.getMonth() + 1
    ).padStart(2, '0');

    const day = String(
      date.getDate()
    ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private createDay(date: Date): CalendarDay {

    const copy = new Date(date);

    return {
      date: copy,
      key: this.dateKey(copy),
      number: copy.getDate(),

      label: copy.toLocaleDateString(
        'en-US',
        {
          weekday: 'short'
        }
      ).toUpperCase(),

      fullLabel: copy.toLocaleDateString(
        'en-US',
        {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        }
      )
    };
  }

  private formatDate(date: Date): string {

    return date.toLocaleDateString(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }
    );
  }

  private formatTime(
    value: string | null
  ): string {

    if (!value) {
      return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleTimeString(
      'en-US',
      {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }
    );
  }

  /* =========================================
     CALENDAR LABELS
     ========================================= */

  get monthLabel(): string {

    return this.selectedDate.toLocaleDateString(
      'en-US',
      {
        month: 'short',
        year: 'numeric'
      }
    );
  }

  get selectedDateLabel(): string {

    return this.selectedDate.toLocaleDateString(
      'en-US',
      {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }
    );
  }

  /* =========================================
     WEEKLY CALENDAR
     ========================================= */

  get weeklyDays(): CalendarDay[] {

    const start = new Date(this.selectedDate);

    start.setDate(
      start.getDate() - start.getDay()
    );

    const days: CalendarDay[] = [];

    for (let i = 0; i < 7; i++) {

      const date = new Date(start);

      date.setDate(
        start.getDate() + i
      );

      days.push(this.createDay(date));
    }

    return days;
  }

  /* =========================================
     MONTHLY CALENDAR
     ========================================= */

  get monthlyDays(): (CalendarDay | null)[] {

    const year = this.selectedDate.getFullYear();
    const month = this.selectedDate.getMonth();

    const firstDay = new Date(
      year,
      month,
      1
    );

    const daysInMonth = new Date(
      year,
      month + 1,
      0
    ).getDate();

    const days: (CalendarDay | null)[] = [];

    for (
      let i = 0;
      i < firstDay.getDay();
      i++
    ) {
      days.push(null);
    }

    for (
      let i = 1;
      i <= daysInMonth;
      i++
    ) {
      days.push(
        this.createDay(
          new Date(year, month, i)
        )
      );
    }

    return days;
  }

  /* =========================================
     CALENDAR ACTIONS
     ========================================= */

  setCalendarMode(
    mode: 'weekly' | 'monthly'
  ): void {
    this.calendarMode = mode;
  }

  selectDate(date: Date): void {
    this.selectedDate = new Date(date);
  }

  isSelected(key: string): boolean {
    return this.dateKey(
      this.selectedDate
    ) === key;
  }

  changePeriod(direction: number): void {

    const current = new Date(
      this.selectedDate
    );

    if (this.calendarMode === 'weekly') {

      current.setDate(
        current.getDate() + direction * 7
      );

      this.selectedDate = current;
      return;
    }

    const year = current.getFullYear();

    const month =
      current.getMonth() + direction;

    const day = current.getDate();

    const targetStart = new Date(
      year,
      month,
      1
    );

    const lastDay = new Date(
      targetStart.getFullYear(),
      targetStart.getMonth() + 1,
      0
    ).getDate();

    this.selectedDate = new Date(
      targetStart.getFullYear(),
      targetStart.getMonth(),
      Math.min(day, lastDay)
    );
  }

  getMarker(
    date: string
  ): 'verified' | 'provisional' | null {

    const dayRecords = this.records.filter(
      record => record.date === date
    );

    if (
      dayRecords.some(
        record => record.status === 'verified'
      )
    ) {
      return 'verified';
    }

    if (
      dayRecords.some(
        record => record.status === 'provisional'
      )
    ) {
      return 'provisional';
    }

    return null;
  }

  get selectedRecord(): DtrRecord | undefined {

    const selectedKey = this.dateKey(
      this.selectedDate
    );

    return this.records.find(
      record => record.date === selectedKey
    );
  }

  /* =========================================
     HOURS
     ========================================= */

  get totalHours(): number {
    return (
      this.verifiedHours +
      this.provisionalHours
    );
  }

  get remainingHours(): number {
    return Math.max(
      0,
      this.requiredHours - this.totalHours
    );
  }

  /* =========================================
     LOAD ATTENDANCE FROM SUPABASE
     ========================================= */

  async loadAttendanceFromSupabase(): Promise<void> {

    try {

      const { data, error } = await this.supabase
        .from('attendance')
        .select('*')
        .eq('student_id', this.studentId)
        .order('created_at', {
          ascending: false
        });

      if (error) {
        throw error;
      }

      let verifiedMinutes = 0;
      let provisionalMinutes = 0;

      this.records = (data || []).map(row => {

        const sourceDate =
          row.time_in ||
          row.created_at;

        const parsedDate = sourceDate
          ? new Date(sourceDate)
          : null;

        const dateStr =
          parsedDate &&
          !Number.isNaN(parsedDate.getTime())
            ? this.dateKey(parsedDate)
            : '';

        const timeIn = this.formatTime(
          row.time_in
        );

        const timeOut = this.formatTime(
          row.time_out
        );

        let minutes = 0;

        if (row.time_in && row.time_out) {

          const start = new Date(
            row.time_in
          ).getTime();

          const end = new Date(
            row.time_out
          ).getTime();

          const difference = end - start;

          if (
            Number.isFinite(difference) &&
            difference > 0
          ) {
            minutes = Math.floor(
              difference / 60000
            );
          }
        }

        const rawStatus = String(
          row.verification_status || ''
        ).toLowerCase();

        let status: DtrStatus = 'provisional';

        if (rawStatus === 'verified') {
          status = 'verified';
        } else if (rawStatus === 'rejected') {
          status = 'rejected';
        }

        if (status === 'verified') {
          verifiedMinutes += minutes;
        } else if (status === 'provisional') {
          provisionalMinutes += minutes;
        }

        return {
          date: dateStr,
          timeIn,
          timeOut,
          status,
          minutes
        };
      });

      this.verifiedHours =
        verifiedMinutes / 60;

      this.provisionalHours =
        provisionalMinutes / 60;

    } catch (error) {

      console.error(
        'DTR: Failed to load attendance:',
        error
      );

      this.records = [];
      this.verifiedHours = 0;
      this.provisionalHours = 0;

    } finally {
      this.refresh();
    }
  }

  /* =========================================
     WEEKLY DATE RANGE
     ========================================= */

  private getWeekRange(): {
    start: Date;
    end: Date;
  } {

    const start = new Date(
      this.selectedDate
    );

    start.setHours(0, 0, 0, 0);

    start.setDate(
      start.getDate() - start.getDay()
    );

    const end = new Date(start);

    end.setDate(
      start.getDate() + 6
    );

    return {
      start,
      end
    };
  }

  /* =========================================
     CREATE WEEKLY PDF
     ========================================= */

  private createWeeklyPdf(): TDocumentDefinitions {
  const { start, end } = this.getWeekRange();

  const colors = {
    primary: '#3157D5',
    violet: '#7556D9',
    orange: '#FF9638',
    background: '#F5F7FC',
    white: '#FFFFFF',
    text: '#1E293B',
    muted: '#64748B',
    border: '#E2E8F0'
  };

  const startKey = this.dateKey(start);
  const endKey = this.dateKey(end);

  const weekRecords = this.records
    .filter(record =>
      record.date >= startKey &&
      record.date <= endKey
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const verifiedMinutes = weekRecords
    .filter(record => record.status === 'verified')
    .reduce((total, record) => total + record.minutes, 0);

  const provisionalMinutes = weekRecords
    .filter(record => record.status === 'provisional')
    .reduce((total, record) => total + record.minutes, 0);

  const verifiedHours = verifiedMinutes / 60;
  const provisionalHours = provisionalMinutes / 60;
  const weeklyTotal = verifiedHours + provisionalHours;

  const formatHours = (minutes: number): string =>
    minutes > 0 ? (minutes / 60).toFixed(1) : '—';

  const attendanceBody: TableCell[][] = [
    ['DATE', 'TIME IN', 'TIME OUT', 'HOURS', 'STATUS'].map(text => ({
      text,
      bold: true,
      color: colors.primary,
      fontSize: 8
    }))
  ];

  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);

    const dayKey = this.dateKey(day);
    const dayRecords = weekRecords.filter(
      record => record.date === dayKey
    );

    if (dayRecords.length === 0) {
      attendanceBody.push([
        this.formatDate(day),
        '—',
        '—',
        '—',
        'No Record'
      ]);
      continue;
    }

    for (const record of dayRecords) {
      const statusLabel =
        record.status === 'verified'
          ? 'Verified'
          : record.status === 'rejected'
            ? 'Rejected'
            : 'Provisional';

      attendanceBody.push([
        this.formatDate(day),
        record.timeIn || '—',
        record.timeOut || '—',
        formatHours(record.minutes),
        {
          text: statusLabel,
          color:
            record.status === 'verified'
              ? colors.primary
              : record.status === 'provisional'
                ? colors.violet
                : colors.muted,
          bold: true
        }
      ]);
    }
  }

  const infoField = (label: string, value: string) => ({
    stack: [
      {
        text: label.toUpperCase(),
        fontSize: 7.5,
        color: colors.muted,
        margin: [0, 0, 0, 4] as [number, number, number, number]
      },
      {
        text: value || 'Not available',
        fontSize: 10,
        bold: true,
        color: colors.text
      }
    ]
  });

  const summaryCell = (
    label: string,
    value: string,
    accent: string
  ) => ({
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          {
            text: label,
            fontSize: 8,
            color: colors.muted,
            margin: [0, 0, 0, 6] as [number, number, number, number]
          },
          {
            text: value,
            fontSize: 15,
            bold: true,
            color: accent
          }
        ],
        fillColor: colors.background,
        margin: [8, 9, 8, 9] as [number, number, number, number]
      }]]
    },
    layout: 'noBorders'
  });

  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [35, 35, 35, 45],

    defaultStyle: {
      font: 'Roboto',
      fontSize: 9,
      color: colors.text
    },

    content: [
      // Corporate blue header
      {
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              {
                columns: [
                  {
                    text: 'INTERNTRACK',
                    bold: true,
                    fontSize: 11,
                    color: colors.white
                  },
                  {
                    text: 'INTERNSHIP RECORD',
                    alignment: 'right',
                    fontSize: 8,
                    color: '#E4EAFF'
                  }
                ]
              },
              {
                text: 'Daily Time Record',
                bold: true,
                fontSize: 21,
                color: colors.white,
                margin: [0, 16, 0, 4]
              },
              {
                text: 'Weekly Attendance Report',
                fontSize: 10,
                color: '#E4EAFF'
              }
            ],
            fillColor: colors.primary,
            margin: [14, 14, 14, 16]
          }]]
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 20]
      },

      // Student information
      {
        table: {
          widths: ['*', '*'],
          body: [
            [
              {
                ...infoField('Student Name', this.studentFullName),
                margin: [8, 8, 8, 10]
              },
              {
                ...infoField('Student ID', this.studentId),
                margin: [8, 8, 8, 10]
              }
            ],
            [
              {
                ...infoField('Company', this.studentCompany),
                margin: [8, 8, 8, 10]
              },
              {
                ...infoField(
                  'Week Covered',
                  `${this.formatDate(start)} - ${this.formatDate(end)}`
                ),
                margin: [8, 8, 8, 10]
              }
            ]
          ]
        },
        layout: {
          fillColor: () => colors.background,
          hLineWidth: () => 0,
          vLineWidth: () => 0
        },
        margin: [0, 0, 0, 22]
      },

      // Attendance heading
      {
        columns: [
          {
            text: 'ATTENDANCE DETAILS',
            bold: true,
            fontSize: 11,
            color: colors.text
          },
          {
            text: 'WEEKLY RECORD',
            alignment: 'right',
            fontSize: 8,
            bold: true,
            color: colors.violet
          }
        ],
        margin: [0, 0, 0, 10]
      },

      // Attendance table
      {
        table: {
          headerRows: 1,
          widths: ['*', 76, 76, 47, 76],
          body: attendanceBody
        },
        layout: {
          fillColor: (rowIndex: number) =>
            rowIndex === 0
              ? '#EAF0FF'
              : rowIndex % 2 === 0
                ? colors.background
                : colors.white,
          hLineColor: () => colors.border,
          vLineColor: () => colors.border,
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          paddingTop: () => 9,
          paddingBottom: () => 9,
          paddingLeft: () => 7,
          paddingRight: () => 7
        },
        margin: [0, 0, 0, 22]
      },

      // Hours summary
      {
        text: 'WEEKLY HOURS SUMMARY',
        bold: true,
        fontSize: 11,
        color: colors.text,
        margin: [0, 0, 0, 10]
      },
      {
        columns: [
          {
            width: '*',
            ...summaryCell(
              'Verified Hours',
              `${verifiedHours.toFixed(1)} hrs`,
              colors.primary
            )
          },
          {
            width: '*',
            ...summaryCell(
              'Provisional Hours',
              `${provisionalHours.toFixed(1)} hrs`,
              colors.violet
            )
          },
          {
            width: '*',
            ...summaryCell(
              'Weekly Total',
              `${weeklyTotal.toFixed(1)} hrs`,
              colors.primary
            )
          }
        ],
        columnGap: 8,
        margin: [0, 0, 0, 12]
      },

      {
        text:
          'Provisional hours are subject to supervisor approval. ' +
          'Rejected records are excluded from the hours summary.',
        fontSize: 8,
        italics: true,
        color: colors.muted,
        margin: [0, 0, 0, 35]
      },

      // Signatures
      {
        columns: [
          {
            width: '*',
            stack: [
              {
                text: '____________________________',
                alignment: 'center'
              },
              {
                text: 'Student Signature',
                alignment: 'center',
                fontSize: 8,
                color: colors.muted,
                margin: [0, 6, 0, 0]
              }
            ]
          },
          {
            width: '*',
            stack: [
              {
                text: '____________________________',
                alignment: 'center'
              },
              {
                text: 'Company Supervisor Signature',
                alignment: 'center',
                fontSize: 8,
                color: colors.muted,
                margin: [0, 6, 0, 0]
              }
            ]
          }
        ],
        columnGap: 25
      }
    ],

    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: 'Generated by InternTrack',
          alignment: 'left'
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: 'right'
        }
      ],
      margin: [35, 0, 35, 0],
      fontSize: 8,
      color: colors.muted
    })
  };

  return definition;
}

  /* =========================================
     GENERATE PDF BLOB
     ========================================= */

  private async generatePdfBlob(): Promise<Blob> {

    const definition =
      this.createWeeklyPdf();

    const blob = await pdfMake
      .createPdf(definition)
      .getBlob();

    return blob;
  }

  /* =========================================
     PDF FILE NAME
     ========================================= */

  private getPdfFilename(): string {

    const { start, end } =
      this.getWeekRange();

    return (
      `InternTrack-DTR-` +
      `${this.dateKey(start)}-to-` +
      `${this.dateKey(end)}.pdf`
    );
  }

  /* =========================================
     ERROR ALERT
     ========================================= */

  private async showError(
    header: string,
    message: string
  ): Promise<void> {

    const alert =
      await this.alertController.create({
        header,
        message,
        buttons: ['OK']
      });

    await alert.present();
  }

  /* =========================================
     PLATFORM DETECTION
     ========================================= */

  private isNativeAndroid(): boolean {

    return (
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android'
    );
  }

  /* =========================================
     CONVERT BLOB TO BASE64
     ========================================= */

  private blobToBase64(
    blob: Blob
  ): Promise<string> {

    return new Promise<string>(
      (resolve, reject) => {

        const reader = new FileReader();

        reader.onload = () => {

          const result = reader.result;

          if (typeof result !== 'string') {

            reject(
              new Error(
                'Unable to convert PDF to Base64.'
              )
            );

            return;
          }

          const commaIndex =
            result.indexOf(',');

          if (commaIndex === -1) {

            reject(
              new Error(
                'Invalid Base64 PDF data.'
              )
            );

            return;
          }

          resolve(
            result.substring(commaIndex + 1)
          );
        };

        reader.onerror = () => {

          reject(
            reader.error ??
            new Error('Failed to read PDF.')
          );
        };

        reader.readAsDataURL(blob);
      }
    );
  }

  /* =========================================
     SAVE NATIVE PDF
     ========================================= */

  private async saveNativePdf(
    blob: Blob,
    filename: string
  ): Promise<string> {

    const base64 =
      await this.blobToBase64(blob);

    const savedFile =
      await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
        recursive: true
      });

    return savedFile.uri;
  }

  /* =========================================
     RENDER PDF PAGES USING PDF.JS
     ========================================= */

  private async renderPdfPages(
    blob: Blob,
    renderVersion: number
  ): Promise<void> {

    const container =
      this.pdfPagesContainer?.nativeElement;

    if (!container) {
      throw new Error(
        'PDF preview container was not found.'
      );
    }

    container.replaceChildren();

    const pdfData = new Uint8Array(
      await blob.arrayBuffer()
    );

    const loadingTask =
      pdfjsLib.getDocument({
        data: pdfData
      });

    const pdf = await loadingTask.promise;

    try {

      for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages;
        pageNumber++
      ) {

        if (
          renderVersion !== this.pdfRenderVersion ||
          !this.isPdfPreviewOpen ||
          this.destroyed
        ) {
          return;
        }

        const page =
          await pdf.getPage(pageNumber);

        const baseViewport =
          page.getViewport({
            scale: 1
          });

        const availableWidth = Math.max(
          100,
          container.clientWidth - 24
        );

        const displayScale =
          availableWidth / baseViewport.width;

        const pixelRatio = Math.min(
          window.devicePixelRatio || 1,
          2
        );

        const viewport =
          page.getViewport({
            scale: displayScale * pixelRatio
          });

        const canvas =
          document.createElement('canvas');

        const context =
          canvas.getContext('2d');

        if (!context) {
          throw new Error(
            'Unable to initialize PDF canvas.'
          );
        }

        canvas.width =
          Math.ceil(viewport.width);

        canvas.height =
          Math.ceil(viewport.height);

        canvas.style.width =
          `${Math.ceil(
            baseViewport.width * displayScale
          )}px`;

        canvas.style.height =
          `${Math.ceil(
            baseViewport.height * displayScale
          )}px`;

        canvas.style.display = 'block';
        canvas.style.maxWidth = '100%';
        canvas.style.margin = '0 auto 12px';
        canvas.style.background = '#ffffff';

        container.appendChild(canvas);

        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport
        });

        await renderTask.promise;
      }

    } finally {
      pdf.cleanup();
    }
  }

  /* =========================================
    PREVIEW WEEKLY DTR
     ========================================= */

  async previewDtr(): Promise<void> {
    if (this.isGeneratingPdf) {
      return;
    }

    this.isGeneratingPdf = true;
    this.refresh();

    try {
      const blob = await this.generatePdfBlob();

      if (!blob.size) {
        throw new Error('The generated PDF is empty.');
      }

      this.closePdfPreview();

      this.isPdfPreviewOpen = true;
      this.refresh();

      // Allow Angular to create the PDF preview container.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      const renderVersion = ++this.pdfRenderVersion;

      await this.renderPdfPages(blob, renderVersion);

    } catch (error: unknown) {
      console.error('DTR PDF preview failed:', error);

      const errorMessage =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);

      this.closePdfPreview();
      this.refresh();

      await this.showError(
        'PDF Preview Error',
        errorMessage
      );

    } finally {
      this.isGeneratingPdf = false;
      this.refresh();
    }
  }

  /* =========================================
    EXPORT WEEKLY DTR
     ========================================= */

  async exportDtr(): Promise<void> {

    if (this.isGeneratingPdf) {
      return;
    }

    this.isGeneratingPdf = true;
    this.refresh();

    try {

      const blob =
        await this.generatePdfBlob();

      const filename =
        this.getPdfFilename();

      if (this.isNativeAndroid()) {

        // Save a temporary PDF for native sharing.
        const fileUri =
          await this.saveNativePdf(
            blob,
            filename
          );

        // Let the student select an Android
        // app or destination for the PDF.
        await Share.share({
          title: 'InternTrack Weekly DTR',
          text: 'Weekly Daily Time Record',
          url: fileUri,
          dialogTitle: 'Save or share your DTR PDF'
        });

      } else {

        // Browser PDF download.
        const url =
          URL.createObjectURL(blob);

        const link =
          document.createElement('a');

        link.href = url;
        link.download = filename;

        document.body.appendChild(link);

        link.click();
        link.remove();

        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 60000);
      }

    } catch (error) {

      console.error(
        'DTR: PDF export failed:',
        error
      );

      await this.showError(
        'Export failed',
        'Unable to export the weekly DTR PDF.'
      );

    } finally {
      this.isGeneratingPdf = false;
      this.refresh();
    }
  }

  /* =========================================
     CLOSE PDF PREVIEW
     ========================================= */

  closePdfPreview(): void {

    // Invalidate any ongoing PDF render.
    this.pdfRenderVersion++;

    this.isPdfPreviewOpen = false;
    this.pdfPreviewUrl = null;
  }
}
