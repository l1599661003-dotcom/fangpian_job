(() => {
  'use strict';

  const comboboxes = new Set();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node instanceof HTMLSelectElement) upgrade(node);
          node.querySelectorAll?.('select').forEach(upgrade);
        });
      }
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLSelectElement) upgrade(mutation.target);
    }
  });

  function optionLabel(option) {
    return (option.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function placeholderFor(select) {
    return select.dataset.placeholder || '输入搜索并选择';
  }

  function dispatchSelectChange(select) {
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function upgrade(select) {
    if (!(select instanceof HTMLSelectElement)) return;
    if (select.dataset.nativeSelect === '1') return;
    const existing = select.closest('.rf-combobox');
    if (select.dataset.comboboxReady === '1') {
      if (existing?.classList.contains('rf-combobox')) {
        const input = existing.querySelector('.rf-combobox-input');
        if (input) {
          if (select.required) {
            input.required = true;
            select.required = false;
          }
          input.disabled = select.disabled;
        }
      }
      return;
    }
    select.dataset.comboboxReady = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'rf-combobox';
    const nativeKey = select.id || select.name || '';
    if (nativeKey) wrapper.dataset.comboboxFor = nativeKey;
    const field = document.createElement('div');
    field.className = 'rf-combobox-field';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'rf-combobox-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.enterKeyHint = 'search';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    const list = document.createElement('div');
    list.className = 'rf-combobox-list';
    list.setAttribute('role', 'listbox');
    const selectedChips = document.createElement('div');
    selectedChips.className = 'rf-combobox-selected';
    field.append(input);
    wrapper.append(field, selectedChips, list);
    select.before(wrapper);
    wrapper.append(select);
    select.closest('label')?.classList.add('rf-combobox-host');
    select.classList.add('rf-combobox-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    Object.entries({
      position: 'absolute',
      top: '0',
      left: '0',
      width: '1px',
      height: '1px',
      minHeight: '0',
      maxHeight: '1px',
      margin: '-1px',
      border: '0',
      padding: '0',
      opacity: '0',
      pointerEvents: 'none',
    }).forEach(([property, value]) => select.style.setProperty(property, value, 'important'));
    if (select.required) {
      input.required = true;
      select.required = false;
    }
    if (select.disabled) input.disabled = true;
    if (select.getAttribute('aria-label')) input.setAttribute('aria-label', select.getAttribute('aria-label'));
    else {
      const label = select.closest('label')?.querySelector(':scope > span, :scope > legend')?.textContent?.trim();
      if (label) input.setAttribute('aria-label', label);
    }
    input.setAttribute('aria-controls', list.id = `rf-combobox-list-${Math.random().toString(36).slice(2)}`);

    let activeIndex = -1;
    let open = false;
    let searching = false;
    let typed = false;

    const visibleOptions = () => {
      const query = typed ? input.value.trim().toLowerCase() : '';
      return [...select.options].filter((option) => {
        const searchText = [optionLabel(option), option.value, option.dataset.search || ''].join(' ').toLowerCase();
        return !option.disabled && (!query || searchText.includes(query));
      });
    };

    const initialActiveIndex = () => {
      const options = visibleOptions();
      const selectedIndex = select.multiple || typed ? -1 : options.findIndex((option) => option.selected && option.value !== '');
      if (selectedIndex >= 0) return selectedIndex;
      const preferred = select.dataset.defaultOption || '';
      const preferredIndex = preferred ? options.findIndex((option) => option.value === preferred) : -1;
      if (preferredIndex >= 0) return preferredIndex;
      const firstValue = options.findIndex((option) => option.value !== '');
      return firstValue >= 0 ? firstValue : (options.length ? 0 : -1);
    };

    const resetQuery = () => {
      typed = false;
      searching = false;
      if (select.multiple) input.value = '';
    };

    const revealOptions = () => {
      if (!window.matchMedia('(max-width: 760px)').matches) {
        list.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (list.getBoundingClientRect().bottom <= window.innerHeight) return;
      input.scrollIntoView({ block: 'start' });
    };

    const setOpen = (nextOpen) => {
      const wasOpen = open;
      open = nextOpen;
      wrapper.classList.toggle('is-open', open);
      input.setAttribute('aria-expanded', String(open));
      if (open) {
        activeIndex = initialActiveIndex();
        renderOptions();
        if (!wasOpen) revealOptions();
      }
    };

    const setActive = (index, { scroll = true } = {}) => {
      const items = [...list.querySelectorAll('.rf-combobox-option:not([disabled])')];
      activeIndex = Math.max(-1, Math.min(index, items.length - 1));
      items.forEach((item, itemIndex) => item.classList.toggle('is-active', itemIndex === activeIndex));
      if (activeIndex >= 0) {
        input.setAttribute('aria-activedescendant', items[activeIndex].id);
        if (scroll) items[activeIndex].scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    };

    function renderOptions({ keepPosition = false } = {}) {
      const scrollTop = list.scrollTop;
      list.replaceChildren();
      const options = visibleOptions();
      options.forEach((option, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'rf-combobox-option';
        item.id = `${list.id}-option-${index}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.disabled = option.disabled;
        const [primary, ...secondary] = optionLabel(option).split(' · ');
        const strong = document.createElement('strong');
        strong.textContent = primary || option.value || '未命名选项';
        item.append(strong);
        if (secondary.length) {
          const small = document.createElement('small');
          small.textContent = secondary.join(' · ');
          item.append(small);
        }
        item.addEventListener('pointerdown', (event) => event.preventDefault());
        item.addEventListener('click', () => {
          if (option.disabled) return;
          if (select.multiple) option.selected = !option.selected;
          else select.value = option.value;
          dispatchSelectChange(select);
          syncDisplay();
          if (!select.multiple) {
            searching = false;
            setOpen(false);
            input.blur();
          } else {
            resetQuery();
            renderOptions({ keepPosition: true });
          }
        });
        list.append(item);
      });
      if (!options.length) {
        const empty = document.createElement('p');
        empty.className = 'rf-combobox-empty';
        empty.textContent = '没有匹配项，请换个关键词';
        list.append(empty);
      }
      const nextActive = Math.max(0, activeIndex);
      setActive(nextActive, { scroll: false });
      if (keepPosition) list.scrollTop = scrollTop;
      else if (nextActive >= 0) {
        const activeItem = list.querySelector('.rf-combobox-option.is-active');
        if (activeItem) list.scrollTop = Math.max(0, activeItem.offsetTop - (list.clientHeight - activeItem.offsetHeight) / 2);
      }
    }

    function renderSelected() {
      selectedChips.replaceChildren();
      if (!select.multiple) return;
      [...select.selectedOptions].forEach((option) => {
        const chip = document.createElement('span');
        chip.className = 'rf-combobox-chip';
        const label = document.createElement('b');
        label.className = 'rf-combobox-chip-label';
        label.textContent = optionLabel(option) || option.value;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `移除${optionLabel(option) || option.value}`);
        remove.addEventListener('click', () => {
          option.selected = false;
          dispatchSelectChange(select);
          syncDisplay();
          if (open) renderOptions({ keepPosition: true });
        });
        chip.append(label, remove);
        selectedChips.append(chip);
      });
    }

    function syncDisplay() {
      renderSelected();
      const placeholder = placeholderFor(select);
      if (select.multiple) {
        const count = select.selectedOptions.length;
        input.placeholder = count ? `已选 ${count} 项，继续搜索` : placeholder;
        return;
      }
      const selected = select.selectedOptions[0];
      if (!searching) input.value = selected && select.value !== '' ? optionLabel(selected) : '';
      input.placeholder = placeholder;
    }

    input.addEventListener('focus', () => {
      typed = false;
      searching = !select.multiple;
      setOpen(true);
      if (!select.multiple) input.select();
    });
    input.addEventListener('input', () => {
      typed = true;
      searching = true;
      activeIndex = -1;
      setOpen(true);
      setActive(visibleOptions().length ? 0 : -1);
      syncDisplay();
    });
    input.addEventListener('click', () => {
      if (!open) setOpen(true);
    });
    input.addEventListener('blur', () => {
      resetQuery();
      if (!select.multiple) syncDisplay();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open) setOpen(true);
        const count = list.querySelectorAll('.rf-combobox-option:not([disabled])').length;
        setActive(event.key === 'ArrowDown' ? activeIndex + 1 : activeIndex - 1);
        if (event.key === 'ArrowDown' && activeIndex >= count) setActive(0);
        if (event.key === 'ArrowUp' && activeIndex < 0) setActive(count - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const active = list.querySelector('.rf-combobox-option.is-active');
        active?.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (open) event.stopPropagation();
        resetQuery();
        syncDisplay();
        setOpen(false);
      }
    });
    select.addEventListener('change', syncDisplay);
    const instance = { select, wrapper, close: () => setOpen(false) };
    comboboxes.add(instance);
    new MutationObserver(() => {
      if (!open) activeIndex = initialActiveIndex();
      syncDisplay();
      if (open) renderOptions({ keepPosition: true });
    }).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled', 'label'] });

    syncDisplay();
    renderOptions();
  }

  document.querySelectorAll('select').forEach(upgrade);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['required', 'disabled'] });
  document.addEventListener('pointerdown', (event) => {
    for (const instance of [...comboboxes]) {
      if (!instance.select.isConnected) {
        comboboxes.delete(instance);
        continue;
      }
      if (!instance.wrapper.contains(event.target)) instance.close();
    }
  });
  window.refreshComboboxes = () => document.querySelectorAll('select').forEach(upgrade);
})();
