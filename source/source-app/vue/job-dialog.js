import { computed, createApp, h, reactive, ref } from 'vue';

let activeApp = null;

function employeeLabel(item, requirePrivateMessage) {
  const department = item.department ? ` · ${item.department}` : '';
  if (!requirePrivateMessage) return `${item.name}${department}`;
  return `${item.name}${department}${item.tianjiWechatId ? ' · 可接收私信' : ' · 未配置私信ID'}`;
}

function matchesEmployee(item, selectedId, selectedName) {
  return item.id === selectedId || (!selectedId && item.name === selectedName);
}

const JobDialog = {
  props: {
    mode: { type: String, default: 'new' },
    position: { type: Object, default: null },
    options: { type: Object, default: () => ({ departments: [], employees: [] }) },
    onSubmit: { type: Function, required: true },
  },
  setup(props) {
    const isEdit = computed(() => props.mode === 'edit');
    const saving = ref(false);
    const message = ref('');
    const touched = reactive({});
    const form = reactive({
      name: props.position?.name || '',
      department: props.position?.department || '',
      salaryText: props.position?.salaryText || '',
      level: props.position?.level || '',
      ownerUserId: '',
      recruiterUserId: '',
      backupRecruiterUserId: '',
      responsibilities: props.position?.responsibilities || '',
      requirements: props.position?.requirements || '',
    });

    const employees = computed(() => props.options?.employees || []);
    const departments = computed(() => props.options?.departments || []);
    const resolveUserId = (selectedId, selectedName) => employees.value.find((item) => matchesEmployee(item, selectedId, selectedName))?.id || '';
    form.ownerUserId = resolveUserId(props.position?.ownerUserId, props.position?.owner);
    form.recruiterUserId = resolveUserId(props.position?.recruiterUserId, props.position?.recruiter);
    form.backupRecruiterUserId = resolveUserId(props.position?.backupRecruiterUserId, props.position?.backupRecruiter);

    const errors = computed(() => ({
      name: form.name.trim() ? '' : '请填写岗位名称',
      department: form.department ? '' : '请选择部门',
      level: form.level ? '' : '请选择岗位层级',
      ownerUserId: form.ownerUserId ? '' : '请选择业务负责人',
      recruiterUserId: form.recruiterUserId ? '' : '请选择接收招聘流程私信的招聘HR',
    }));
    const invalid = computed(() => Object.values(errors.value).some(Boolean));

    const people = (requirePrivateMessage) => employees.value.map((item) => ({
      value: item.id,
      label: employeeLabel(item, requirePrivateMessage),
      disabled: requirePrivateMessage && !item.tianjiWechatId,
    }));

    const mark = (key) => { touched[key] = true; };
    const showError = (key) => Boolean(touched[key] && errors.value[key]);

    async function submit(event) {
      Object.keys(errors.value).forEach(mark);
      if (invalid.value) {
        requestAnimationFrame(() => {
          event.currentTarget?.querySelector('.rf-job-field.invalid input, .rf-job-field.invalid textarea, .rf-job-field.invalid .rf-combobox-input')?.focus();
        });
        return;
      }
      saving.value = true;
      message.value = '';
      const employeeName = (userId) => employees.value.find((item) => item.id === userId)?.name || '';
      try {
        await props.onSubmit({
          name: form.name.trim(),
          department: form.department,
          salaryText: form.salaryText.trim(),
          level: form.level,
          ownerUserId: form.ownerUserId,
          owner: employeeName(form.ownerUserId),
          recruiterUserId: form.recruiterUserId,
          recruiter: employeeName(form.recruiterUserId),
          backupRecruiterUserId: form.backupRecruiterUserId,
          backupRecruiter: employeeName(form.backupRecruiterUserId),
          responsibilities: form.responsibilities,
          requirements: form.requirements,
          operator: window.recruitmentCurrentUser?.name || '当前用户',
        }, event.currentTarget);
      } catch (error) {
        message.value = String(error?.message || error || '保存失败');
        saving.value = false;
      }
    }

    const field = (key, label, control, hint = '', required = false) => {
      const error = showError(key) ? errors.value[key] : '';
      return h('label', {
        class: ['rf-job-field', { invalid: Boolean(error), wide: key === 'name' || key === 'responsibilities' || key === 'requirements' }],
      }, [
        h('span', [label, required ? h('b', ' *') : null]),
        control,
        error ? h('small', { class: 'error', role: 'alert' }, error) : (hint ? h('small', hint) : null),
      ]);
    };

    const textInput = (key, placeholder) => h('input', {
      value: form[key],
      placeholder,
      autocomplete: 'off',
      onInput: (event) => { form[key] = event.target.value; },
      onBlur: () => mark(key),
    });

    const selectInput = (key, placeholder, items) => h('select', {
      value: form[key],
      onChange: (event) => { form[key] = event.target.value; mark(key); },
      onBlur: () => mark(key),
    }, [
      h('option', { value: '' }, placeholder),
      ...items.map((item) => h('option', { value: item.value || item.name, disabled: item.disabled }, item.label || item.name)),
    ]);

    return () => h('form', { class: 'rf-job-vue', onSubmit: (event) => event.preventDefault() }, [
      h('header', { class: 'rf-job-vue-head' }, [
        h('span', isEdit.value ? 'EDIT POSITION' : 'NEW POSITION'),
        h('h2', isEdit.value ? '编辑岗位' : '新增岗位'),
        h('p', isEdit.value ? '更新岗位基础信息和任职要求。' : '填写岗位信息后加入公司岗位库。带 * 的字段保存前必须填写。'),
      ]),
      h('div', { class: 'rf-job-vue-grid' }, [
        field('name', '岗位名称', textInput('name', '例如 内容运营、品牌策划'), '', true),
        field('department', '部门', selectInput('department', '请选择部门', departments.value.map((item) => ({ name: item.name }))), '', true),
        field('salaryText', '薪资', textInput('salaryText', '例如 8K-12K，可留空')),
        field('level', '岗位层级', selectInput('level', '请选择岗位层级', ['普通岗位', '中高层岗位'].map((item) => ({ value: item, label: item }))), '中高层用于内推积分：面试 3 分、Offer 6 分、入职 9 分。', true),
        field('ownerUserId', '业务负责人', selectInput('ownerUserId', '请选择业务负责人', people(false)), '岗位的业务归属人，负责确认用人需求。', true),
        field('recruiterUserId', '招聘HR', selectInput('recruiterUserId', '请选择接收招聘待办的HR', people(true)), '意向沟通、约面、Offer 和入职待办会私信给这位 HR。', true),
        field('backupRecruiterUserId', '备用招聘HR', selectInput('backupRecruiterUserId', '不设置备用HR', people(true)), '主 HR 私信失败时，待办自动转给备用 HR。'),
        field('responsibilities', '工作职责', h('textarea', {
          value: form.responsibilities,
          placeholder: '一条一行，写清楚日常要做的事',
          onInput: (event) => { form.responsibilities = event.target.value; },
        })),
        field('requirements', '任职要求', h('textarea', {
          value: form.requirements,
          placeholder: '一条一行，写经验和能力要求',
          onInput: (event) => { form.requirements = event.target.value; },
        })),
      ]),
      h('footer', [
        message.value ? h('p', { role: 'status' }, message.value) : null,
        h('button', { class: 'btn-primary', type: 'button', disabled: saving.value, onClick: submit }, saving.value ? '正在保存…' : '保存岗位'),
      ]),
    ]);
  },
};

window.mountJobDialog = (root, props) => {
  window.unmountJobDialog();
  activeApp = createApp(JobDialog, props);
  activeApp.mount(root);
};

window.unmountJobDialog = () => {
  activeApp?.unmount();
  activeApp = null;
};
