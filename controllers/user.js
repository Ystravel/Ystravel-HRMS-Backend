import User from '../models/user.js'
import mongoose from 'mongoose'
import { StatusCodes } from 'http-status-codes'
import { OAuth2Client } from 'google-auth-library'
import jwt from 'jsonwebtoken'
import validator from 'validator'
import AuditLog from '../models/auditLog.js'
import { getNextUserNumber } from '../utils/sequence.js'
import Company from '../models/company.js' // 新增
import { roleNames } from '../enums/UserRole.js'
import Department from '../models/department.js' // 新增
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { fileURLToPath } from 'url'
import path, { dirname } from 'path'
import { v2 as cloudinary } from 'cloudinary'

const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
})

export const create = async (req, res) => {
  try {
    const userId = await getNextUserNumber()

    // 從請求中提取公司 ID
    const { company, department } = req.body
    const companyData = await Company.findById(company)
    const departmentData = await Department.findById(department)

    if (!companyData) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: '找不到選定的公司' })
    }

    if (!departmentData) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: '找不到選定的部門' })
    }

    const randomPassword = crypto.randomBytes(8).toString('hex')

    const result = await User.create({
      ...req.body,
      userId,
      company,
      department,
      password: randomPassword,
      isFirstLogin: true
    })

    // 更完整的變更記錄
    const changes = {
      name: {
        from: null,
        to: result.name
      },
      userId: {
        from: null,
        to: result.userId
      },
      email: {
        from: null,
        to: result.email
      },
      gender: {
        from: null,
        to: result.gender
      },
      IDNumber: {
        from: null,
        to: result.IDNumber
      },
      company: {
        from: null,
        to: companyData.name
      },
      department: {
        from: null,
        to: departmentData.name
      },
      role: {
        from: null,
        to: roleNames[result.role]
      },
      employmentStatus: {
        from: null,
        to: result.employmentStatus
      },
      salary: {
        from: null,
        to: result.salary
      },
      cowellAccount: {
        from: null,
        to: result.cowellAccount
      },
      cowellPassword: {
        from: null,
        to: result.cowellPassword
      },
      englishName: {
        from: null,
        to: result.englishName
      },
      permanentAddress: {
        from: null,
        to: result.permanentAddress
      },
      contactAddress: {
        from: null,
        to: result.contactAddress
      },
      emergencyName: {
        from: null,
        to: result.emergencyName
      },
      emergencyCellphone: {
        from: null,
        to: result.emergencyCellphone
      },
      emergencyRelationship: {
        from: null,
        to: result.emergencyRelationship
      },
      hireDate: {
        from: null,
        to: result.hireDate
      }
    }

    // 添加可選欄位
    if (result.jobTitle) {
      changes.jobTitle = {
        from: null,
        to: result.jobTitle
      }
    }
    if (result.cellphone) {
      changes.cellphone = {
        from: null,
        to: result.cellphone
      }
    }
    if (result.extNumber) {
      changes.extNumber = {
        from: null,
        to: result.extNumber
      }
    }
    if (result.birthDate) {
      changes.birthDate = {
        from: null,
        to: result.birthDate
      }
    }
    if (result.printNumber) {
      changes.printNumber = {
        from: null,
        to: result.printNumber
      }
    }
    if (result.guideLicense !== undefined) {
      changes.guideLicense = {
        from: null,
        to: result.guideLicense
      }
    }

    await AuditLog.create({
      operatorId: req.user._id,
      operatorInfo: {
        name: req.user.name,
        userId: req.user.userId
      },
      action: '創建',
      targetId: result._id,
      targetInfo: {
        name: result.name,
        userId: result.userId,
        departmentId: departmentData.departmentId,
        companyId: companyData.companyId
      },
      targetModel: 'users',
      changes
    })

    res.status(StatusCodes.OK).json({
      success: true,
      message: '用戶創建成功',
      result: {
        ...result.toObject(),
        password: undefined
      }
    })
  } catch (error) {
    console.error('Create user error:', error)
    if (error.name === 'ValidationError') {
      const key = Object.keys(error.errors)[0]
      const message = error.errors[key].message
      res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message
      })
    } else if (error.name === 'MongoServerError' && error.code === 11000) {
      let message = ''
      if (error.keyValue.email) {
        message = 'Email已註冊'
      } else if (error.keyValue.IDNumber) {
        message = '身分證號碼已註冊'
      } else if (error.keyValue.cellphone) {
        message = '手機號碼已註冊'
      } else if (error.keyValue.extNumber) {
        message = '分機號碼已註冊'
      } else if (error.keyValue.printNumber) {
        message = '列印編號已註冊'
      } else if (error.keyValue.userId) {
        message = '員工編號已註冊'
      } else if (error.keyValue.cowellAccount) {
        message = '科威帳號已註冊'
      } else {
        message = '某些欄位值已註冊'
      }
      res.status(StatusCodes.CONFLICT).json({
        success: false,
        message
      })
    } else {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: '未知錯誤'
      })
    }
  }
}
// 用戶登入

export const login = async (req, res) => {
  try {
    if (req.user.employmentStatus !== '在職') {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: '此帳號已停用，如有疑問請聯絡人資部門'
      })
    }

    const token = jwt.sign({ _id: req.user._id }, process.env.JWT_SECRET, { expiresIn: '10h' })
    req.user.tokens.push(token)
    await req.user.save()

    if (req.user.isFirstLogin) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: '首次登入,請修改密碼',
        result: {
          token,
          isFirstLogin: true
        }
      })
    }
    res.status(StatusCodes.OK).json({
      success: true,
      message: '',
      result: {
        token,
        name: req.user.name,
        englishName: req.user.englishName,
        birthDate: req.user.birthDate,
        gender: req.user.gender,
        cellphone: req.user.cellphone,
        email: req.user.email,
        permanentAddress: req.user.permanentAddress,
        contactAddress: req.user.contactAddress,
        emergencyName: req.user.emergencyName,
        emergencyCellphone: req.user.emergencyCellphone,
        userId: req.user.userId,
        company: req.user.company,
        hireDate: req.user.hireDate,
        extNumber: req.user.extNumber,
        printNumber: req.user.printNumber,
        guideLicense: req.user.guideLicense,
        role: req.user.role,
        jobTitle: req.user.jobTitle,
        avatar: req.user.avatar,
        cowellAccount: req.user.cowellAccount,
        cowellPassword: req.user.cowellPassword
      }
    })
  } catch (error) {
    console.error(error)
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '未知錯誤'
    })
  }
}

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage'
)
// Google 驗證回調
export const googleLogin = async (req, res) => {
  try {
    const { code } = req.body
    const { tokens } = await oauth2Client.getToken(code)
    const idToken = tokens.id_token
    const ticket = await oauth2Client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    })

    const payload = ticket.getPayload()
    const email = payload.email

    const user = await User.findOne({ email }).populate('company')
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '此Email尚未註冊,請聯絡人資'
      })
    }

    if (user.employmentStatus !== '在職') {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: '此帳號已停用，如有疑問請聯絡人資部門'
      })
    }

    const jwtToken = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '10h'
    })

    user.tokens.push(jwtToken)
    await user.save()

    res.status(200).json({
      success: true,
      message: '登入成功',
      result: {
        token: jwtToken,
        name: user.name,
        englishName: user.englishName,
        birthDate: user.birthDate,
        gender: user.gender,
        cellphone: user.cellphone,
        email: user.email,
        permanentAddress: user.permanentAddress,
        contactAddress: user.contactAddress,
        emergencyName: user.emergencyName,
        emergencyCellphone: user.emergencyCellphone,
        userId: user.userId,
        company: user.company,
        hireDate: user.hireDate,
        extNumber: user.extNumber,
        printNumber: user.printNumber,
        guideLicense: user.guideLicense,
        role: user.role,
        jobTitle: user.jobTitle,
        avatar: user.avatar,
        cowellAccount: user.cowellAccount,
        cowellPassword: user.cowellPassword
      }
    })
  } catch (error) {
    console.error('Google驗證錯誤:', error)
    res.status(500).json({
      success: false,
      message: 'Google驗證失敗',
      error: error.message
    })
  }
}

// 延長用戶登入 token
// export const extend = async (req, res) => {
//   try {
//     // 添加檢查用戶狀態
//     if (req.user.employmentStatus !== '在職') {
//       return res.status(StatusCodes.FORBIDDEN).json({
//         success: false,
//         message: '此帳號已停用，如有疑問請聯絡人資部門'
//       })
//     }

//     const idx = req.user.tokens.findIndex(token => token === req.token)
//     const token = jwt.sign({ _id: req.user._id }, process.env.JWT_SECRET, { expiresIn: '1m' })
//     req.user.tokens[idx] = token
//     await req.user.save()
//     res.status(StatusCodes.OK).json({
//       success: true,
//       message: '',
//       result: token
//     })
//   } catch (error) {
//     handleError(res, error)
//   }
// }

// 取得當前用戶資料
export const profile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('company', 'name') // populate 公司資訊
      .populate('department', 'name companyId') // populate 部門資訊

    res.status(StatusCodes.OK).json({
      success: true,
      message: '',
      result: {
        email: user.email,
        IDNumber: user.IDNumber,
        gender: user.gender,
        name: user.name,
        englishName: user.englishName,
        cellphone: user.cellphone,
        salary: user.salary,
        extNumber: user.extNumber,
        birthDate: user.birthDate,
        permanentAddress: user.permanentAddress,
        contactAddress: user.contactAddress,
        department: user.department,
        company: user.company,
        jobTitle: user.jobTitle,
        role: user.role,
        userId: user.userId,
        hireDate: user.hireDate,
        emergencyName: user.emergencyName,
        emergencyCellphone: user.emergencyCellphone,
        printNumber: user.printNumber,
        guideLicense: user.guideLicense,
        avatar: user.avatar,
        cowellAccount: user.cowellAccount,
        cowellPassword: user.cowellPassword
      }
    })
  } catch (error) {
    handleError(res, error)
  }
}

// 取得所有用戶資料（包含分頁與排序）
export const getAll = async (req, res) => {
  try {
    const itemsPerPage = req.query.itemsPerPage * 1 || 10
    const page = parseInt(req.query.page) || 1

    const {
      search,
      quickSearch,
      role,
      companyId, // 使用 companyId
      departmentId, // 使用 departmentId
      gender,
      guideLicense,
      employmentStatus
    } = req.query

    // 構建查詢條件
    const query = {}

    if (req.query.hireDateStart && req.query.hireDateEnd) {
      console.log('Hire Date Range:', req.query.hireDateStart, req.query.hireDateEnd)
      query.hireDate = {
        $gte: new Date(req.query.hireDateStart),
        $lte: new Date(req.query.hireDateEnd)
      }
    }

    if (req.query.resignationDateStart && req.query.resignationDateEnd) {
      query.resignationDate = {
        $gte: new Date(req.query.resignationDateStart),
        $lte: new Date(req.query.resignationDateEnd)
      }
    }

    if (req.query.birthDateStart && req.query.birthDateEnd) {
      query.birthDate = {
        $gte: new Date(req.query.birthDateStart),
        $lte: new Date(req.query.birthDateEnd)
      }
    }

    console.log('Query parameters:', req.query)

    // 這裡先處理與 OR 無關的查詢條件
    if (role !== undefined && role !== '') {
      query.role = Number(role)
    }

    if (companyId && companyId !== '') {
      query.company = new mongoose.Types.ObjectId(companyId)
    }

    if (departmentId && departmentId !== '') {
      query.department = new mongoose.Types.ObjectId(departmentId)
    }

    if (gender !== undefined && gender !== '') {
      query.gender = gender
    }

    if (guideLicense !== undefined && guideLicense !== '') {
      query.guideLicense = guideLicense === 'true'
    }

    if (employmentStatus !== undefined && employmentStatus !== '') {
      query.employmentStatus = employmentStatus
    }

    // 處理搜尋條件
    const searchConditions = []

    if (search) {
      searchConditions.push({
        $or: [
          { name: new RegExp(search, 'i') },
          { englishName: new RegExp(search, 'i') },
          { email: new RegExp(search, 'i') },
          { userId: new RegExp(search, 'i') },
          { cellphone: new RegExp(search, 'i') },
          { extNumber: new RegExp(search, 'i') },
          { printNumber: new RegExp(search, 'i') },
          { jobTitle: new RegExp(search, 'i') },
          { note: new RegExp(search, 'i') }
        ]
      })
    }

    if (quickSearch) {
      searchConditions.push({
        $or: [
          { name: new RegExp(quickSearch, 'i') },
          { userId: new RegExp(quickSearch, 'i') },
          { cellphone: new RegExp(quickSearch, 'i') },
          { extNumber: new RegExp(quickSearch, 'i') },
          { email: new RegExp(quickSearch, 'i') },
          { printNumber: new RegExp(quickSearch, 'i') }
        ]
      })
    }

    // 組合所有查詢條件
    const finalQuery = { ...query }
    if (searchConditions.length > 0) {
      finalQuery.$and = searchConditions
    }

    // 計算總數
    const total = await User.countDocuments(finalQuery)

    // 構建排序條件
    const sortBy = req.query.sortBy || 'userId'
    const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1
    const sort = { [sortBy]: sortOrder }

    // 獲取資料並 populate 關聯
    const result = await User.find(finalQuery)
      .populate('company', 'name companyId')
      .populate('department', 'name departmentId')
      .sort(sort)
      .skip((page - 1) * itemsPerPage)
      .limit(itemsPerPage)

    console.log('Query:', finalQuery) // 加入這行來檢查查詢條件
    console.log('Result count:', result.length) // 加入這行來檢查結果數量

    res.status(StatusCodes.OK).json({
      success: true,
      message: '',
      result: {
        data: result,
        totalItems: total || 0,
        itemsPerPage,
        currentPage: page
      }
    })
  } catch (error) {
    console.error('Get users error:', error)
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '獲取用戶列表時發生錯誤',
      error: error.message
    })
  }
}

export const getSuggestions = async (req, res) => {
  try {
    const search = req.query.search || ''

    // 構建搜索條件
    const searchRegex = new RegExp(search, 'i')
    const query = {
      $or: [
        { name: searchRegex },
        { userId: searchRegex },
        { email: searchRegex }
      ]
    }

    // 限制返回數量並只返回必要欄位
    const users = await User.find(query)
      .select('name userId email')
      .limit(10)

    res.status(StatusCodes.OK).json({
      success: true,
      result: users
    })
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '獲取用戶建議失敗',
      error: error.message
    })
  }
}

export const getEmployeeStats = async (req, res) => {
  try {
    // 使用 aggregation pipeline 來獲取所有在職員工的公司分佈
    const companyStats = await User.aggregate([
      {
        $match: {
          employmentStatus: '在職'
        }
      },
      {
        // 關聯 companies 集合
        $lookup: {
          from: 'companies',
          localField: 'company',
          foreignField: '_id',
          as: 'companyInfo'
        }
      },
      {
        // 解構關聯後的陣列
        $unwind: {
          path: '$companyInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        // 按公司分組並計數
        $group: {
          _id: '$company',
          count: { $sum: 1 },
          companyName: { $first: '$companyInfo.name' }
        }
      }
    ])

    // 計算總在職人數
    const totalActive = companyStats.reduce((sum, company) => sum + company.count, 0)

    // 格式化響應數據
    const stats = {
      total: totalActive,
      companies: companyStats.map(stat => ({
        companyId: stat._id,
        companyName: stat.companyName || '未分類',
        count: stat.count
      }))
    }

    res.status(StatusCodes.OK).json({
      success: true,
      result: stats
    })
  } catch (error) {
    console.error('Error getting employee stats:', error)
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '獲取員工統計資料失敗',
      error: error.message
    })
  }
}

// 用戶登出
export const logout = async (req, res) => {
  try {
    req.user.tokens = req.user.tokens.filter(token => token !== req.token)
    await req.user.save()

    res.status(StatusCodes.OK).json({
      success: true,
      message: '登出成功'
    })
  } catch (error) {
    handleError(res, error)
  }
}

export const remove = async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) throw new Error('ID')

    const user = await User.findById(req.params.id).populate('department')
    if (!user) {
      throw new Error('NOT FOUND')
    }

    // 刪除用戶
    await user.deleteOne()

    // 記錄刪除操作
    await AuditLog.create({
      operatorId: req.user._id,
      operatorInfo: {
        name: req.user.name,
        userId: req.user.userId
      },
      action: '刪除',
      targetId: user._id,
      targetInfo: {
        name: user.name,
        userId: user.userId
      },
      targetModel: 'users',
      changes: {
        name: {
          from: user.name,
          to: null
        },
        userId: {
          from: user.userId,
          to: null
        },
        email: {
          from: user.email,
          to: null
        },
        company: {
          from: user.company.name,
          to: null
        },
        employmentStatus: {
          from: user.employmentStatus,
          to: null
        }
      }
    })

    res.status(StatusCodes.OK).json({
      success: true,
      message: '用戶刪除成功'
    })
  } catch (error) {
    console.error('Delete user error:', error)
    handleError(res, error)
  }
}

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    const user = await User.findById(req.user._id)

    // 添加檢查用戶狀態
    if (user.employmentStatus !== '在職') {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: '此帳號已停用，如有疑問請聯絡人資部門'
      })
    }

    // 如果不是首次登入,驗證當前密碼
    if (!user.isFirstLogin) {
      if (!bcrypt.compareSync(currentPassword, user.password)) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: '當前密碼輸入錯誤'
        })
      }
    }

    // 驗證新密碼長度
    if (newPassword.length < 8) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: '新密碼長度至少需要8個字元'
      })
    }

    // 更新密碼
    user.password = newPassword // mongoose pre save hook 會自動進行 hash
    user.isFirstLogin = false // 修改密碼後設為 false
    await user.save()

    // 記錄密碼變更
    await AuditLog.create({
      operatorId: user._id,
      operatorInfo: { // 加入這個
        name: user.name,
        userId: user.userId
      },
      action: '修改',
      targetId: user._id,
      targetInfo: { // 加入這個
        name: user.name,
        userId: user.userId
      },
      targetModel: 'users',
      changes: {
        description: { // 修改格式
          from: '原密碼',
          to: '新密碼'
        }
      }
    })

    res.status(StatusCodes.OK).json({
      success: true,
      message: '密碼更新成功'
    })
  } catch (error) {
    console.error('Change password error:', error)
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '密碼更新失敗'
    })
  }
}

// 編輯用戶資料（僅限管理員）
// 在 user controller 中修改 edit 函數
export const edit = async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) throw new Error('ID')

    // 先獲取原始用戶數據，並展開公司資訊
    const originalUser = await User.findById(req.params.id).populate('company')
    if (!originalUser) {
      throw new Error('NOT FOUND')
    }

    const updateData = { ...req.body }
    delete updateData.password

    // 創建一個只包含已更改欄位的物件
    const changedFields = {}
    const auditChanges = {}

    // 處理公司相關的變更
    if (updateData.company && updateData.company !== originalUser.company.toString()) {
      const newCompany = await Company.findById(updateData.company)
      if (!newCompany) {
        return res.status(StatusCodes.BAD_REQUEST).json({ message: '找不到選定的公司' })
      }

      changedFields.company = updateData.company
      auditChanges.company = {
        from: originalUser.company.name,
        to: newCompany.name
      }
    }

    // 處理所有其他欄位的變更
    Object.keys(updateData).forEach(key => {
      // 跳過已處理的欄位
      if (key === 'company') return

      // 處理日期類型
      if (key === 'birthDate' || key === 'hireDate' || key === 'resignationDate') {
        const originalDate = originalUser[key] ? originalUser[key].toISOString() : null
        const newDate = updateData[key] ? new Date(updateData[key]).toISOString() : null
        if (originalDate !== newDate) {
          changedFields[key] = updateData[key]
          auditChanges[key] = {
            from: originalDate,
            to: newDate
          }
        }
      } else if (key === 'role' && originalUser[key]?.toString() !== updateData[key]?.toString()) {
        // 處理角色欄位
        changedFields[key] = updateData[key]
        auditChanges[key] = {
          from: roleNames[originalUser[key]] || `未知角色(${originalUser[key]})`,
          to: roleNames[updateData[key]] || `未知角色(${updateData[key]})`
        }
      } else if (originalUser[key]?.toString() !== updateData[key]?.toString()) {
        // 處理其他欄位
        changedFields[key] = updateData[key]
        auditChanges[key] = {
          from: originalUser[key],
          to: updateData[key]
        }
      }
    })

    // 如果有欄位被更改才更新數據
    if (Object.keys(changedFields).length > 0) {
      const user = await User.findByIdAndUpdate(
        req.params.id,
        changedFields,
        { new: true, runValidators: true }
      ).populate('company')

      // 記錄變更
      await AuditLog.create({
        operatorId: req.user._id,
        operatorInfo: {
          name: req.user.name,
          userId: req.user.userId
        },
        action: '修改',
        targetId: user._id,
        targetInfo: {
          name: user.name,
          userId: user.userId
        },
        targetModel: 'users',
        changes: auditChanges
      })

      res.status(StatusCodes.OK).json({
        success: true,
        message: '用戶資料更新成功',
        result: user
      })
    } else {
      res.status(StatusCodes.OK).json({
        success: true,
        message: '沒有欄位被修改',
        result: originalUser
      })
    }
  } catch (error) {
    console.error(error)

    // 修改錯誤處理部分
    if (error.name === 'ValidationError') {
      const key = Object.keys(error.errors)[0]
      const message = error.errors[key].message
      res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message
      })
    } else if (error.name === 'MongoServerError' && error.code === 11000) {
      let message = ''
      if (error.keyValue.email) {
        message = 'Email已註冊'
      } else if (error.keyValue.IDNumber) {
        message = '身分證號碼已註冊'
      } else if (error.keyValue.cellphone) {
        message = '手機號碼已註冊'
      } else if (error.keyValue.extNumber) {
        message = '分機號碼已註冊'
      } else if (error.keyValue.printNumber) {
        message = '列印編號已註冊'
      } else if (error.keyValue.userId) {
        message = '員工編號已註冊'
      } else if (error.keyValue.cowellAccount) {
        message = '科威帳號已註冊'
      } else if (error.keyValue.cowellPassword) {
        message = '科威密碼已註冊'
      } else {
        message = '某些欄位值已註冊'
      }
      res.status(StatusCodes.CONFLICT).json({
        success: false,
        message
      })
    } else if (error.message === 'ID') {
      res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: '用戶 ID 格式錯誤'
      })
    } else if (error.message === 'NOT FOUND') {
      res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: '查無用戶'
      })
    } else {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: '未知錯誤'
      })
    }
  }
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 發送重置密碼郵件
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body
    const user = await User.findOne({ email })

    if (!user) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: '此電子郵件未註冊'
      })
    }

    // 檢查用戶狀態
    if (user.employmentStatus !== '在職') {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: '此帳號已停用，如有疑問請聯絡人資部門'
      })
    }

    const currentDate = new Date()

    // 檢查上次發送郵件的時間
    if (user.lastEmailSent) {
      const timeSinceLastEmail = currentDate - user.lastEmailSent
      const fiveMinutes = 5 * 60 * 1000 // 5分鐘轉換為毫秒

      if (timeSinceLastEmail < fiveMinutes) {
        const waitTimeSeconds = Math.ceil((fiveMinutes - timeSinceLastEmail) / 1000)
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: `請等待 ${waitTimeSeconds} 秒後再試`
        })
      }
    }

    // 生成重置 token
    const resetToken = crypto.randomBytes(32).toString('hex')

    // 更新用戶資料
    user.resetPasswordToken = resetToken
    user.resetPasswordExpires = new Date(currentDate.getTime() + (30 * 60 * 1000)) // 30分鐘後過期
    user.lastEmailSent = currentDate // 記錄發送時間

    await user.save()

    const resetUrl = `${process.env.FRONTEND_URL}/#/reset-password/${resetToken}`

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Ysphere - 永信星球 密碼重置請求',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #333;">密碼重置請求</h2>
          </div>
          
          <div style="background: #f7f7f7; padding: 28px; border-radius: 5px; margin-bottom: 20px;">
            <p style="margin-top: 0; font-size: 14px; font-weight: 600">${user.name} 您好，</p>
            <p style="font-size: 14px; font-weight: 500">我們收到了您的密碼重置請求。請點擊下方連結重置您的密碼：</p>
            <div style="text-align: center; margin: 40px 0;">
              <a href="${resetUrl}" 
                  style="background: #495866; color: white; padding: 12px 24px; 
                        text-decoration: none; letter-spacing:2px; font-size:14px; border-radius: 5px; display: inline-block;">
                重置密碼
              </a>
            </div>
            <p style="color: #666; font-size: 13px;">
              此連結將在30分鐘後失效。<br>
            </p>
            <p style="color: #666; font-size: 13px;">
              如果您沒有請求重置密碼，請忽略此郵件。
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <p>感謝您的使用！</p>
            <p style="color: #666; margin-bottom: 20px;">Ysphere ERP System</p>
            <img src="cid:logo" alt="YSTravel Logo" style="max-width: 150px; height: auto;">
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>此為系統自動發送的郵件，請勿直接回覆</p>
          </div>
        </div>
      `,
      attachments: [{
        filename: 'logo.png',
        path: path.join(__dirname, '../public/images/logo_horizontal.png'), // 請確保這個路徑指向你的 logo 圖片
        cid: 'logo' // 這個 ID 需要和 HTML 中的 cid 匹配
      }]
    }

    await transporter.sendMail(mailOptions)

    res.status(StatusCodes.OK).json({
      success: true,
      message: '重置密碼郵件已發送，請檢查您的信箱'
    })
  } catch (error) {
    console.error('忘記密碼錯誤:', error)
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '發送重置郵件時發生錯誤'
    })
  }
}
// 重置密碼
// 在 controller 中修改 resetPassword 函數
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body

    // 使用 lean() 獲取純 JavaScript 物件
    const user = await User.findOne({
      resetPasswordToken: token
    }).lean()

    if (!user || !user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: '重置連結無效或已過期'
      })
    }

    // 檢查用戶狀態
    if (user.employmentStatus !== '在職') {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: '此帳號已停用，如有疑問請聯絡人資部門'
      })
    }

    // 驗證新密碼長度
    if (newPassword.length < 8) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: '新密碼長度至少需要8個字元'
      })
    }

    // 更新使用者資料
    const updatedUser = await User.findByIdAndUpdate(user._id, {
      $set: {
        password: bcrypt.hashSync(newPassword, 10)
      },
      $unset: {
        resetPasswordToken: 1,
        resetPasswordExpires: 1,
        lastEmailSent: 1
      }
    }, { new: true })

    // 記錄密碼重置
    await AuditLog.create({
      operatorId: updatedUser._id,
      operatorInfo: { // 加入這個
        name: updatedUser.name,
        userId: updatedUser.userId
      },
      action: '修改',
      targetId: updatedUser._id,
      targetInfo: { // 加入這個
        name: updatedUser.name,
        userId: updatedUser.userId
      },
      targetModel: 'users',
      changes: {
        description: { // 修改格式
          from: '舊密碼',
          to: '透過郵件重置的新密碼'
        }
      }
    })

    res.status(StatusCodes.OK).json({
      success: true,
      message: '密碼重置成功，請使用新密碼登入'
    })
  } catch (error) {
    console.error('重置密碼錯誤:', error)
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '重置密碼時發生錯誤'
    })
  }
}

// 更新用戶頭像
export const updateAvatar = async (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: '未提供頭像文件'
      })
    }

    const user = await User.findById(req.user._id)
    if (!user) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: '找不到用戶'
      })
    }

    // 如果用戶有舊頭像且不是默認頭像，則刪除
    if (user.avatar && !user.avatar.includes('multiavatar')) {
      // 從 Cloudinary URL 中提取 public_id
      const publicId = user.avatar.split('/').pop().split('.')[0]
      try {
        await cloudinary.uploader.destroy(`avatars/${publicId}`)
      } catch (error) {
        console.error('刪除舊頭像失敗:', error)
        // 即使刪除舊頭像失敗，我們仍然繼續更新新頭像
      }
    }

    user.avatar = req.file.path // 更新用戶的頭像URL
    await user.save()

    res.status(StatusCodes.OK).json({
      success: true,
      message: '頭像更新成功',
      result: user.avatar
    })
  } catch (error) {
    console.error('更新頭像錯誤:', error)
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '更新頭像失敗'
    })
  }
}

// 新增發送初始密碼的功能
export const sendInitialPassword = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: '找不到該用戶'
      })
    }

    if (!user.isFirstLogin) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: '該用戶已完成首次登入'
      })
    }

    // 生成新的隨機密碼
    const randomPassword = crypto.randomBytes(8).toString('hex')
    user.password = randomPassword
    await user.save()

    // 發送郵件
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Ysphere - 永信星球 系統初始密碼',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #333;">系統初始密碼</h2>
          </div>
          
          <div style="background: #f7f7f7; padding: 28px; border-radius: 5px; margin-bottom: 20px;">
            <p style="margin-top: 0; font-size: 14px; font-weight: 600">${user.name} 您好，</p>
            <p style="font-size: 14px; font-weight: 500">這是您的系統初始密碼：</p>
            <div style="text-align: center; margin: 20px 0;">
              <div style="background: #eee; padding: 12px; border-radius: 4px; font-size: 18px; font-family: monospace;">
                ${randomPassword}
              </div>
            </div>
            <p style="color: #666; font-size: 13px;">
              請使用此密碼進行首次登入，系統會要求您立即修改密碼。
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <p style="color: #666; margin-bottom: 20px;">Ysphere ERP System</p>
            <img src="cid:logo" alt="Ysphere LOGO" style="max-width: 150px; height: auto;">
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>此為系統自動發送的郵件，請勿直接回覆</p>
          </div>
        </div>
      `,
      attachments: [{
        filename: 'logo.png',
        path: path.join(__dirname, '../public/images/logo_horizontal.png'), // 請確保這個路徑指向你的 logo 圖片
        cid: 'logo' // 這個 ID 需要和 HTML 中的 cid 匹配
      }]
    }

    await transporter.sendMail(mailOptions)

    res.status(StatusCodes.OK).json({
      success: true,
      message: '初始密碼已發送成功'
    })
  } catch (error) {
    console.error('發送初始密碼錯誤:', error)
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '發送初始密碼失敗'
    })
  }
}

export const revealCowell = async (req, res) => {
  try {
    const { password } = req.body

    // 驗證用戶輸入的密碼
    const user = await User.findById(req.user._id)
    if (!user) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: '找不到用戶'
      })
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: '密碼錯誤'
      })
    }

    // 返回科威帳號和密碼
    res.status(StatusCodes.OK).json({
      success: true,
      message: '驗證成功',
      result: {
        cowellAccount: user.cowellAccount,
        cowellPassword: user.cowellPassword
      }
    })
  } catch (error) {
    console.error('Reveal Cowell error:', error)
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '無法查看科威帳號和密碼'
    })
  }
}

// 統一錯誤處理
const handleError = (res, error) => {
  console.error('Error details:', error) // 增加錯誤詳細資訊的日誌
  if (error.name === 'ValidationError') {
    const key = Object.keys(error.errors)[0]
    const message = error.errors[key].message
    res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message
    })
  } else if (error.name === 'MongoServerError' && error.code === 11000) {
    res.status(StatusCodes.CONFLICT).json({
      success: false,
      message: 'Email、身分證、手機、分機號碼、列印編號或員工編號已註冊'
    })
  } else if (error.message === 'ID') {
    res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: '用戶 ID 格式錯誤'
    })
  } else if (error.message === 'NOT FOUND') {
    res.status(StatusCodes.NOT_FOUND).json({
      success: false,
      message: '查無用戶'
    })
  } else {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '未知錯誤'
    })
  }
}
